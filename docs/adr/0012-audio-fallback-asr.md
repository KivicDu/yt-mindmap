# ADR 0012 — Transcribe the audio when a video has no captions

## Status
Proposed — design approved before implementation

## Context

Today `POST /transcript` has exactly one source: the caption tracks YouTube
already holds. When there is none, the learner gets a hint and a manual
`.srt`/`.vtt` upload, and the map stays empty. In practice that is the most
common dead end, because the failure codes that stop a map are the ones that
are most likely on real lectures:

| Code | What it means | How common |
| --- | --- | --- |
| `transcripts_disabled` | The uploader turned captions off | Common on course channels |
| `no_transcript` | No manual track and no auto-generated track | Common on small channels |
| `empty_transcript` | A track exists but has no cues | Rare |
| `age_restricted` | YouTube will not serve the page to the server | Occasional |
| `ip_blocked` / `po_token_required` | YouTube is throttling this server | Occasional |

The learner can already watch those videos — the player is an iframe — so the
content exists and is playable. The only thing missing is text.

The decision this ADR records: **captions stay the first and preferred source,
and a Gemini audio transcription is the fallback when YouTube has no captions
at all.** Nothing else in the pipeline changes; once cues exist, the map is
built from them exactly as before.

## Decision

### 1. Fallback policy

```
POST /transcript {url}
        │
        ├─ fetch_transcript(url) succeeds ──────────► 200, as today
        │
        └─ fails with a caption-absence code
                ├─ ASR disabled / not signed in / over quota ─► 422, as today
                └─ otherwise ────────────────────────────────► 202 + job_id
```

ASR is attempted **only** for these codes:

- `transcripts_disabled`
- `no_transcript`
- `empty_transcript`

Everything else keeps its current answer. `ip_blocked`, `po_token_required`,
`age_restricted` and `video_unavailable` mean the server cannot reach the media
at all, so downloading the audio would fail for the same reason and only add
minutes of latency before the same error.

The fallback also requires a **video id**. A bare `.srt` upload or a text paste
never reaches this path.

### 2. Sign-in and quota

Audio transcription costs money on every run, so it is not offered to
anonymous visitors. Guests keep today's message plus the upload hint.

New settings, all off by default so the code can ship before the cost is
approved:

```python
ASR_ENABLED: bool = False
ASR_MODEL: str = "gemini-2.5-flash"
ASR_MAX_VIDEO_SECONDS: int = 10_800        # 3 h; longer videos are refused
ASR_DAILY_LIMIT_PER_USER: int = 3
ASR_MAX_CONCURRENCY: int = 2
ASR_JOB_TTL_SECONDS: int = 3_600           # sweep finished/failed jobs
ASR_AUDIO_BITRATE: str = "32k"             # mono 16 kHz mp3
```

`ASR_DAILY_LIMIT_PER_USER` is a counter in the existing in-memory limiter,
keyed `asr:{user_id}:{utc_date}`. The finished transcript cache (below) means a
repeat view of the same video does not consume the quota.

### 3. Job model

A transcription takes minutes, so it cannot run inside the request. It follows
the same shape as the session store (ADR 0002): an in-memory dict on the single
uvicorn worker, plus a TTL sweep.

```
queued ──► downloading ──► transcribing ──► ready
   │            │               │
   └────────────┴───────────────┴──► failed
   └────────────────────────────────► cancelled
```

- Jobs live in `asr_jobs: dict[str, dict]`, keyed by a UUID, and carry
  `user_id` so only the owner can read or cancel one.
- A `threading.Semaphore(ASR_MAX_CONCURRENCY)` bounds simultaneous runs;
  extra jobs wait in `queued`.
- `cleanup_asr_jobs()` runs on the same hook as `cleanup_sessions()` and drops
  anything finished for longer than `ASR_JOB_TTL_SECONDS`.
- A backend restart loses in-flight jobs. That is accepted: the learner
  retries, and the finished-transcript cache makes the retry cheap.

### 4. API

New endpoints, additive; nothing existing changes shape.

```
POST /transcript {url}
  202 { status: "asr_queued",
        job_id, video_id, title, language: null,
        asr: { stage: "queued", elapsed_seconds: 0, max_seconds: <estimate> } }

GET /transcript/asr/{job_id}          # owner only
  200 { job_id, status, stage, elapsed_seconds, audio_seconds,
        error?: { code, message },
        session?: <session payload, only when status == "ready"> }

DELETE /transcript/asr/{job_id}       # owner only
  200 { status: "cancelled" }
```

`session` is the **same payload** the 200 path of `POST /transcript` returns,
so the frontend applies a finished job with the existing `applyLoadResult`
code path and no second loading logic.

Polling (2 s) is chosen over SSE because the session does not exist yet: the
SSE channel is keyed by `session_id`, and inventing a session for a job that
may never produce cues would put a broken entry in `sessions`.

### 5. Transcription

```
yt-dlp  →  mp3, mono, 16 kHz, ASR_AUDIO_BITRATE  →  Gemini  →  cues
```

- **`yt-dlp` as a Python library** (`yt_dlp.YoutubeDL`), not a subprocess, so
  the command line cannot be injected and the format selection is one place.
  Format: `bestaudio/best`.
- **`ffmpeg` in the image** to convert to mp3. Gemini's documented audio
  formats do not include m4a reliably, and mono 16 kHz at 32 kbps turns a
  1-hour lecture into ~14 MB instead of ~60 MB, which cuts upload time to the
  Files API. This is the one new system package: `apt-get install -y --no-install-recommends ffmpeg`.
- **Gemini Files API** for anything over the inline limit. Upload, generate,
  then `client.files.delete(...)` in a `finally`. Files also expire on their
  own after 48 h, so a crash does not leave anything permanent.
- Audio is written to a `mkstemp` file under `data/asr/`, removed in `finally`,
  and the directory is swept on startup. No audio is stored long-term.
- The model is asked to transcribe in the spoken language, **not** to
  translate or summarise, and to return JSON:

```json
[{"start": 12.4, "text": "…"}, {"start": 31.0, "text": "…"}]
```

- Segments are capped at ~20 s of speech. Cue parsing is defensive:

  1. strict `json.loads` (after stripping a ```json fence);
  2. if that fails, `[mm:ss]` / `[ss.s]` line prefixes;
  3. if there are no timestamps at all, the text is split on sentence
     boundaries and distributed across `duration` (from `yt-dlp`) by character
     count.

  Step 3 is a real fallback, not an error: the map is still correct, only the
  seek precision degrades. Timestamps from a prompt are approximate (±1–3 s),
  which is well inside what a study map needs.

### 6. Cache and provenance

A finished transcript is a property of the video, not of one learner, so it is
stored once and shared:

```sql
CREATE TABLE video_transcripts (
    video_id          VARCHAR(11) PRIMARY KEY,
    language          VARCHAR(20),
    cues              JSON        NOT NULL,
    source            VARCHAR(20) NOT NULL,   -- 'asr'
    duration_seconds  FLOAT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Reopening the same video — by the same learner or another one — reads this row
and skips both the download and the Gemini call. Only cues derived from a
public YouTube video are stored; nothing user-specific goes in this table.

`projects.transcript_source` records where the current project's cues came
from, so the UI can be honest about quality:

| Value | Meaning |
| --- | --- |
| `youtube_manual` | Human-written captions |
| `youtube_auto` | YouTube's own ASR |
| `upload` | Learner uploaded `.srt` / `.vtt` |
| `asr` | This fallback |

`fetch_transcript` currently returns `(entries, language)`. It becomes a small
`TranscriptResult(entries, language, generated)` so the caller can distinguish
manual from auto without a second YouTube request.

### 7. UI

- The player renders immediately on 202 — the learner can start watching while
  the transcript is being produced.
- The map pane shows a skeleton with a plain explanation:

  > Video này không có phụ đề. IVAN đang nghe audio để tự tạo phụ đề — thường
  > mất 1–2 phút cho mỗi 10 phút video.

  with elapsed time and a **Huỷ** button.
- On `ready`, the transcript appears and the map starts building from the
  current playhead, exactly like a normal load.
- On `failed`, the existing caption-only message returns, plus the upload hint.
- The transcript tab header carries a badge: *Phụ đề tự động (YouTube)*,
  *IVAN nghe audio*, or *Bạn tải lên*. The project list shows the same badge,
  so a shared map never looks more authoritative than it is.
- The export is unchanged; provenance stays in the app, not in the file.

### 8. New error codes

| Code | Status | Vietnamese copy |
| --- | --- | --- |
| `asr_sign_in_required` | 401 | Đăng nhập để IVAN tự nghe audio cho video không có phụ đề. |
| `asr_disabled` | 422 | Tính năng nghe audio đang tắt. Bạn có thể tải file .srt/.vtt. |
| `asr_quota_exceeded` | 429 | Hôm nay bạn đã dùng hết lượt nghe audio. Thử lại vào mai, hoặc tải .srt/.vtt. |
| `asr_too_long` | 422 | Video dài hơn 3 tiếng nên chưa nghe tự động được. Tải .srt/.vtt giúp nhé. |
| `asr_audio_blocked` | 502 | Không tải được audio của video này. YouTube có thể đang chặn máy chủ. |
| `asr_failed` | 502 | Nghe audio không thành công. Thử lại, hoặc tải file .srt/.vtt. |

`asr_audio_blocked` and `asr_failed` both end in the same place — the manual
upload hint — but they are separate codes because only one of them is worth
retrying.

## Consequences

- A video with no captions now produces a map instead of an empty pane. This is
  the single biggest gap between "demo" and "usable for a real course".
- Cost is bounded by three things: the sign-in requirement, the per-user daily
  limit, and the shared `video_transcripts` cache. A popular lecture is paid for
  once.
- The image grows by `yt-dlp` (pure Python) and `ffmpeg` (~60 MB). `ffmpeg` is
  the only new system package.
- Downloads are fragile by nature. YouTube changes its player often, and yt-dlp
  is the moving target that keeps up with it — so the pin must be bumped
  regularly, and `asr_audio_blocked` must always degrade to the upload hint
  rather than a dead end.
- In-flight jobs die with the process. Acceptable at this scale; the retry is
  cheap because the audio is cached only after success.
- Prompt-derived timestamps are approximate. Seeking lands within a few seconds
  rather than exactly on the word.
- Downloading audio sits in a grey area of YouTube's terms. The feature should
  be described in the UI as "nghe audio" for a video the learner is already
  watching, and the setting stays off until it is deliberately enabled.

## Alternatives considered

- **faster-whisper on the server** — rejected for now: free per run, but
  10–20 minutes of CPU for a one-hour lecture, a ~500 MB model in the image,
  and no punctuation or terminology advantage over Gemini. Worth revisiting if
  audio must never leave the server.
- **OpenAI `whisper-1` / `gpt-4o-transcribe`** — rejected: a second provider and
  key for no gain, plus a 25 MB per-file limit that forces chunking and
  stitching.
- **Transcribe in the browser (Web Speech / WASM Whisper)** — rejected: minutes
  of CPU per hour of audio, tab must stay open, and it cannot run while the
  learner is watching.
- **Ask Gemini for the whole transcript with no timestamps** — rejected: the map
  is a study artefact whose whole value is seeking back to the moment, so cues
  need a `start`.
- **Run the job synchronously inside `POST /transcript`** — rejected: a
  3-minute request blocks the worker and times out behind any proxy.
- **Return the job over SSE** — rejected: the SSE channel is keyed by
  `session_id`, and there is no session until the cues exist.
- **Store transcripts per project instead of per video** — rejected: the same
  lecture is opened by many learners, and per-project rows would pay for the
  same audio over and over.
- **Trigger ASR on `age_restricted` / `ip_blocked` too** — rejected: those mean
  the server cannot reach YouTube at all, so the download would fail too.

## Implementation plan

1. **Backend, no UI** — `backend/asr.py` (download + Gemini + cue repair),
   `video_transcripts` table and `projects.transcript_source`
   (`alembic/versions/0009_asr_fallback.py`), job store and three endpoints,
   settings, error codes, quota. Unit tests with a fake downloader and a fake
   Gemini client: the fallback decision table, cue parsing (all three repair
   paths), job state machine, owner-only access, TTL sweep.
2. **Frontend** — 202 handling, polling, progress panel with cancel, `ready`
   reuse of `applyLoadResult`, new error copy.
3. **Provenance** — badge in the transcript tab and the project list,
   `transcript_source` written on every load path.
4. **Docs** — this ADR accepted, `docs/architecture.md` gains the job and the
   table, `.env.example` gains the `ASR_*` block, README notes the ffmpeg
   requirement.

Each step is a separate commit on `feature/asr-fallback`, PR into `develop`.
