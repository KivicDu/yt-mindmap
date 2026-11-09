"""Turn a YouTube link into a list of caption cues.

Two things this module deliberately does *not* do:

* it never asks YouTube for a specific language only – the mind map is built
  from the language the video was recorded in, so a Vietnamese lecture uses
  its Vietnamese captions instead of failing on a missing English track;
* it never lets the upstream library's stack-trace-ish messages reach the
  browser. Every failure is re-raised as ``TranscriptError`` with a small,
  stable ``code`` that the frontend can translate.
"""

import re
from urllib.parse import parse_qs, urlsplit

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    AgeRestricted,
    InvalidVideoId,
    IpBlocked,
    NoTranscriptFound,
    PoTokenRequired,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
    VideoUnplayable,
    YouTubeDataUnparsable,
    YouTubeRequestFailed,
    YouTubeTranscriptApiException,
)

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

_YOUTUBE_HOSTS = {
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "youtu.be",
}

# Path prefixes that carry the id in the next segment: /shorts/<id>, /embed/<id>,
# /live/<id>, /v/<id> (legacy) and /e/<id> (legacy embed).
_VIDEO_PATH_PREFIXES = {"shorts", "embed", "live", "v", "e"}


class TranscriptError(Exception):
    """A caption failure with a code the UI can present in the user's language."""

    def __init__(self, code: str, message: str, status_code: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def extract_video_id(value: str | None) -> str | None:
    """Return the 11-character id from any common YouTube URL (or a bare id).

    Accepts ``watch?v=``, ``youtu.be/``, ``shorts/``, ``embed/``, ``live/``,
    ``v/``, ``m.``/``music.`` subdomains and URLs without a scheme. Returns
    ``None`` for anything else so callers can show a "wrong link" hint instead
    of asking YouTube about garbage.
    """

    if not value:
        return None

    candidate = value.strip()
    if VIDEO_ID_RE.fullmatch(candidate):
        return candidate

    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", candidate):
        candidate = f"https://{candidate}"

    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None

    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in _YOUTUBE_HOSTS:
        return None

    if host == "youtu.be":
        segment = _first_segment(parsed.path)
        return segment if segment and VIDEO_ID_RE.fullmatch(segment) else None

    # /watch?v=<id>, and the odd /watch/attribution links that carry ?v=.
    query_id = parse_qs(parsed.query).get("v", [""])[0]
    if VIDEO_ID_RE.fullmatch(query_id):
        return query_id

    segments = [part for part in parsed.path.split("/") if part]
    if len(segments) >= 2 and segments[0].lower() in _VIDEO_PATH_PREFIXES:
        segment = segments[1]
        return segment if VIDEO_ID_RE.fullmatch(segment) else None

    return None


def _first_segment(path: str) -> str | None:
    segments = [part for part in path.split("/") if part]
    return segments[0] if segments else None


def _select_transcript(listing, lang: str | None):
    """Pick the best track: requested language, then manual, then original auto.

    ``TranscriptList`` iterates manually created tracks before generated ones,
    and the generated track is always in the video's own language – exactly the
    order we want. Translations are never in the listing, so they can never win
    over the original audio.
    """

    transcripts = list(listing)
    if not transcripts:
        raise NoTranscriptFound(
            getattr(listing, "video_id", "unknown"), [lang or "original"], listing
        )

    if lang:
        wanted = lang.lower()
        base = wanted.split("-")[0]
        for transcript in transcripts:
            code = (transcript.language_code or "").lower()
            if code == wanted or code.split("-")[0] == base:
                return transcript

    return transcripts[0]


def _as_transcript_error(error: Exception) -> TranscriptError:
    """Map the library's exception tree onto codes the frontend understands."""

    if isinstance(error, TranscriptError):
        return error
    if isinstance(error, InvalidVideoId):
        return TranscriptError(
            "invalid_video_id", "That link does not contain a usable video id.", 400
        )
    if isinstance(error, TranscriptsDisabled):
        return TranscriptError(
            "transcripts_disabled",
            "Captions are turned off for this video.",
        )
    if isinstance(error, NoTranscriptFound):
        return TranscriptError(
            "no_transcript",
            "This video has no captions in a language we can use.",
        )
    if isinstance(error, AgeRestricted):
        return TranscriptError(
            "age_restricted",
            "This video is age-restricted and cannot be read without signing in.",
            403,
        )
    if isinstance(error, IpBlocked):
        return TranscriptError(
            "ip_blocked",
            "YouTube is blocking this server's IP address.",
            429,
        )
    if isinstance(error, PoTokenRequired):
        return TranscriptError(
            "po_token_required",
            "YouTube now requires a proof-of-origin token for this video.",
            403,
        )
    if isinstance(error, RequestBlocked):
        return TranscriptError(
            "request_blocked",
            "YouTube is rate-limiting requests from this server.",
            429,
        )
    if isinstance(error, VideoUnavailable):
        return TranscriptError(
            "video_unavailable",
            "The video is private, deleted or not available in this region.",
            404,
        )
    if isinstance(error, VideoUnplayable):
        return TranscriptError(
            "video_unplayable",
            "YouTube refuses to serve this video to the server.",
            404,
        )
    if isinstance(error, YouTubeDataUnparsable):
        return TranscriptError(
            "youtube_unparsable",
            "YouTube returned a page this client could not read.",
            502,
        )
    if isinstance(error, YouTubeRequestFailed):
        return TranscriptError(
            "youtube_unreachable",
            "The request to YouTube failed.",
            502,
        )
    if isinstance(error, YouTubeTranscriptApiException):
        return TranscriptError(
            "youtube_error",
            "YouTube rejected the request for this video.",
            502,
        )
    return TranscriptError(
        "network_error",
        "Could not reach YouTube. Check the connection and try again.",
        502,
    )


def list_transcript_languages(url: str) -> list[dict[str, object]]:
    """Available caption tracks, manual first, de-duplicated by language code.

    The UI only calls this when the learner opens the language picker, so the
    extra YouTube listing never sits on the normal load path.
    """

    video_id = extract_video_id(url)
    if not video_id:
        raise TranscriptError("invalid_url", "That is not a YouTube video link.", 400)

    api = YouTubeTranscriptApi()
    try:
        listing = api.list(video_id)
        tracks = list(listing)
    except Exception as error:  # noqa: BLE001 - converted to a typed error below
        raise _as_transcript_error(error) from error

    seen: set[str] = set()
    items: list[dict[str, object]] = []
    for track in tracks:
        code = str(track.language_code or "").lower()
        if not code or code in seen:
            continue
        seen.add(code)
        items.append(
            {
                "code": code,
                "name": str(track.language or code),
                "generated": bool(getattr(track, "is_generated", False)),
            }
        )
    # Manual tracks are usually the better transcript; offer them first.
    items.sort(key=lambda item: (bool(item["generated"]), str(item["name"]).lower()))
    return items


def fetch_transcript(
    url: str, lang: str | None = None
) -> tuple[list[dict[str, object]], str]:
    """Fetch captions for ``url`` and return ``(entries, language_code)``.

    ``lang`` is optional: when omitted the video's own language wins. When it is
    provided (an explicit user preference) a matching track is preferred, then
    the picker falls back to the original instead of failing.
    """

    video_id = extract_video_id(url)
    if not video_id:
        raise TranscriptError(
            "invalid_url", "That is not a YouTube video link.", 400
        )

    api = YouTubeTranscriptApi()
    try:
        listing = api.list(video_id)
        selected = _select_transcript(listing, lang)
        fetched = selected.fetch()
    except Exception as error:  # noqa: BLE001 - converted to a typed error below
        raise _as_transcript_error(error) from error

    entries = [
        {
            "start": float(line.start),
            "duration": float(line.duration),
            "text": str(line.text),
        }
        for line in fetched
    ]
    if not entries:
        raise TranscriptError(
            "empty_transcript", "The caption track for this video is empty."
        )

    return entries, selected.language_code or "unknown"
