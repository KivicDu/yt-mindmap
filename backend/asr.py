"""Audio fallback for videos with no captions (ADR 0012).

Nothing in this module is called unless the caption path returned one of three
absence codes, the feature flag is on, the learner signed in and the separate
daily quota allowed the job. Network work is injected so unit tests never
download audio or call a provider: ``downloader`` and ``client`` are plain
objects with the same small surface as ``yt_dlp.YoutubeDL`` and the Gemini SDK.

The returned cues have exactly the shape the rest of the app already consumes:
``[{"start": float, "text": str}, ...]``.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Only these mean "the captions do not exist". A blocked or throttled server
# would fail to download the audio for the same reason, so it is not retried.
CAPTION_ABSENCE_CODES = frozenset(
    {"transcripts_disabled", "no_transcript", "empty_transcript"}
)

ASR_ERRORS: dict[str, tuple[int, str]] = {
    "asr_sign_in_required": (
        401,
        "Đăng nhập để IVAN tự nghe audio cho video không có phụ đề.",
    ),
    "asr_disabled": (
        422,
        "Tính năng nghe audio đang tắt. Bạn có thể tải file .srt/.vtt.",
    ),
    "asr_quota_exceeded": (
        429,
        "Hôm nay bạn đã dùng hết lượt nghe audio. Thử lại vào mai, hoặc tải .srt/.vtt.",
    ),
    "asr_too_long": (
        422,
        "Video dài hơn 3 tiếng nên chưa nghe tự động được. Tải .srt/.vtt giúp nhé.",
    ),
    "asr_audio_blocked": (
        502,
        "Không tải được audio của video này. YouTube có thể đang chặn máy chủ.",
    ),
    "asr_failed": (
        502,
        "Nghe audio không thành công. Thử lại, hoặc tải file .srt/.vtt.",
    ),
}

TRANSCRIBE_PROMPT = """Transcribe the audio in the language it is spoken in.
Do not translate, summarise or add commentary. Return ONLY a JSON array of
objects with numeric `start` (seconds from the beginning) and `text` (one short
segment of at most 20 seconds of speech), for example:
[{"start": 12.4, "text": "..."}, {"start": 31.0, "text": "..."}]
Keep the original wording, including technical terms."""


def asr_error(code: str) -> ASRError:
    """Build the typed error for one of the stable ADR 0012 codes."""
    return ASRError(code)


class ASRError(Exception):
    """A stable, translatable failure with the status the API should answer."""

    def __init__(self, code: str, status_code: int | None = None, message: str | None = None):
        default_status, default_message = ASR_ERRORS.get(code, (502, "Audio fallback failed."))
        self.code = code
        self.status_code = status_code or default_status
        self.message = message or default_message
        super().__init__(self.message)

    def detail(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


def should_attempt_asr(code: str) -> bool:
    return code in CAPTION_ABSENCE_CODES


def _normalise_cues(raw: Any) -> list[dict[str, Any]]:
    cues: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return cues
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            start = float(item.get("start"))
        except (TypeError, ValueError):
            continue
        text = str(item.get("text") or "").strip()
        if start < 0 or not text:
            continue
        cues.append({"start": start, "text": text})
    cues.sort(key=lambda cue: cue["start"])
    return cues


def _strip_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped.strip()


def _parse_clock(value: str) -> float | None:
    parts = value.split(":")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return None
    if len(numbers) == 3:
        hours, minutes, seconds = numbers
        return hours * 3600 + minutes * 60 + seconds
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    if len(numbers) == 1:
        return numbers[0]
    return None


# Require either brackets or a clock/decimal so a plain sentence that starts
# with a number ("2024 saw ...") is not mistaken for a timestamp.
_TIMESTAMP_LINE = re.compile(
    r"^\s*(?:"
    r"[\[(]\s*((?:\d{1,3}:){0,2}\d{1,2}(?:\.\d+)?)\s*[\])]"
    r"|((?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,3}\.\d+))"
    r")\s*(.*)$"
)


def parse_cues(text: str, duration: float | None = None) -> list[dict[str, Any]]:
    """Turn a model answer into cues, repairing the three common response shapes."""
    cleaned = _strip_fence(text or "")
    if not cleaned:
        return []

    # 1. The requested shape: strict JSON.
    try:
        strict = _normalise_cues(json.loads(cleaned))
        if strict:
            return strict
    except (TypeError, ValueError, json.JSONDecodeError):
        pass

    # 2. Timestamp-prefixed lines, e.g. `[01:23] text` or `12.4 text`.
    stamped: list[dict[str, Any]] = []
    for line in cleaned.splitlines():
        match = _TIMESTAMP_LINE.match(line)
        if match is None:
            continue
        clock = match.group(1) or match.group(2)
        start = _parse_clock(clock)
        body = match.group(3).strip()
        if start is not None and body:
            stamped.append({"start": start, "text": body})
    if stamped:
        stamped.sort(key=lambda cue: cue["start"])
        return stamped

    # 3. No timestamps at all: distribute sentences over the video duration.
    # Seeking is then approximate, but the study map is still usable.
    sentences = [part.strip() for part in re.split(r"[.!?。！？]+", cleaned) if part.strip()]
    if not sentences:
        return []
    weights = [max(1, len(part)) for part in sentences]
    total = sum(weights)
    span = float(duration) if duration and duration > 0 else len(sentences) * 5.0
    distributed: list[dict[str, Any]] = []
    cursor = 0.0
    for sentence, weight in zip(sentences, weights, strict=False):
        distributed.append({"start": round(cursor, 2), "text": sentence})
        cursor += span * weight / total
    return distributed


def _youtube_dl(options: dict[str, Any]):
    try:
        import yt_dlp
    except ImportError as exc:  # pragma: no cover - depends on the image
        raise ASRError("asr_failed") from exc
    return yt_dlp.YoutubeDL(options)


def probe_duration(url: str, *, downloader: Any | None = None) -> float | None:
    """Read the video length without downloading anything, for the 3 h guard."""
    if downloader is None:
        downloader = _youtube_dl(
            {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}
        )
    try:
        info = downloader.extract_info(url, download=False)
    except Exception as exc:
        logger.warning("ASR duration probe failed: %s", type(exc).__name__)
        raise ASRError("asr_audio_blocked") from exc
    if not isinstance(info, dict):
        return None
    try:
        value = float(info.get("duration") or 0)
    except (TypeError, ValueError):
        return None
    return value or None


def _download_audio(
    url: str,
    directory: Path,
    *,
    bitrate: str,
    downloader: Any | None = None,
) -> Path:
    """Extract mono 16 kHz mp3 audio into ``directory`` and return its path."""
    if downloader is None:
        quality = str(bitrate).removesuffix("k")
        downloader = _youtube_dl(
            {
                "format": "bestaudio/best",
                "outtmpl": str(directory / "audio.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": quality,
                        # Mono 16 kHz keeps a one-hour lecture near 14 MB.
                        "postprocessor_args": ["-ac", "1", "-ar", "16000"],
                    }
                ],
            }
        )
    try:
        downloader.extract_info(url, download=True)
    except Exception as exc:
        logger.warning("ASR audio download failed: %s", type(exc).__name__)
        raise ASRError("asr_audio_blocked") from exc
    audio = next(iter(sorted(directory.glob("*.mp3"))), None)
    if audio is None or audio.stat().st_size == 0:
        raise ASRError("asr_audio_blocked")
    return audio


def _generate_with_client(client: Any, model: str, audio: Path) -> str:
    from ai_engine import genai_types

    upload_config: Any = (
        genai_types.UploadFileConfig(mime_type="audio/mpeg")
        if genai_types is not None and hasattr(genai_types, "UploadFileConfig")
        else {"mime_type": "audio/mpeg"}
    )
    generate_config: Any = (
        genai_types.GenerateContentConfig(response_mime_type="application/json", temperature=0)
        if genai_types is not None
        else {"response_mime_type": "application/json", "temperature": 0}
    )
    uploaded = None
    try:
        uploaded = client.files.upload(file=str(audio), config=upload_config)
        response = client.models.generate_content(
            model=model,
            contents=[TRANSCRIBE_PROMPT, uploaded],
            config=generate_config,
        )
        return str(getattr(response, "text", "") or "")
    except ASRError:
        raise
    except Exception as exc:
        logger.warning("ASR model call failed: %s", type(exc).__name__)
        raise ASRError("asr_failed") from exc
    finally:
        if uploaded is not None:
            try:
                name = getattr(uploaded, "name", None)
                if name:
                    client.files.delete(name)
            except Exception:
                # Files expire after 48 h on their own; a failed delete must
                # never fail an otherwise successful transcription.
                pass


def transcribe(
    url: str,
    *,
    client: Any,
    model: str = "gemini-2.5-flash",
    bitrate: str = "32k",
    duration: float | None = None,
    data_dir: str | Path | None = None,
    downloader: Any | None = None,
    on_stage: Any | None = None,
    should_cancel: Any | None = None,
) -> tuple[list[dict[str, Any]], float | None]:
    """Download, transcribe and parse one video. The caller owns the cache write."""
    if client is None:
        raise ASRError("asr_failed")
    root = Path(data_dir) if data_dir is not None else Path(__file__).resolve().parent / "data"
    asr_dir = root / "asr"
    asr_dir.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="job-", dir=asr_dir))
    try:
        if on_stage:
            on_stage("downloading")
        audio = _download_audio(url, workdir, bitrate=bitrate, downloader=downloader)
        if should_cancel and should_cancel():
            raise ASRError("asr_failed")
        if on_stage:
            on_stage("transcribing")
        raw = _generate_with_client(client, model, audio)
        cues = parse_cues(raw, duration)
        if not cues:
            raise ASRError("asr_failed")
        return cues, duration
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
