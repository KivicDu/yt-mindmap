from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import asyncio
import json
import logging
import os
import threading
import time
import uuid
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from ai_engine import MAX_RESTRUCTURE_CHARS, ai_engine, nodes_to_markdown, normalize_mode
from app.api.deps import get_current_user, get_optional_user
from app.api.router import api_router
from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import SessionLocal, get_db
from app.middleware.rate_limit import RateLimitMiddleware, charge_extra_ai_unit
from app.models.project import Project
from app.models.user import User
from app.models.video_transcript import VideoTranscript
from app.schemas.project import AutosaveRequest, OutputLanguageRequest
from app.services import (
    content_classifier,
    content_policy,
    map_verifier,
    stream_tickets,
    video_visuals,
)
from app.services import projects as project_service
from app.services import sharing as sharing_service
from app.services.asr_jobs import (
    cancel_job,
    cleanup_asr_jobs,
    create_job,
    get_job,
    job_payload,
    sweep_audio_dir,
)
from app.services.rate_limit import asr_quota
from asr import ASRError, asr_error, probe_duration, should_attempt_asr, transcribe
from chunking import chunk_time_range, is_seek_backward, select_chunk
from node_tree import (
    markdown_to_tree,
    merge_nodes,
    normalize_cached_nodes,
    normalize_nodes,
    strip_private_fields,
    tree_to_markdown,
    update_node,
)
from subtitles import parse_vtt_or_srt
from transcript import (
    TranscriptError,
    extract_video_id,
    fetch_transcript,
    list_transcript_languages,
)

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
] or DEFAULT_ALLOWED_ORIGINS

logger = logging.getLogger(__name__)

app = FastAPI(title="YouTube Mind Map API", version="0.3.0")

# Registered before CORS so CORS stays the outermost layer and 429 responses
# still carry the headers a browser needs to read them.
app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Accounts, projects and sharing live under /api so the existing mind-map
# endpoints keep their URLs. The refresh cookie requires allow_credentials.
app.include_router(api_router, prefix="/api")

# A single anonymous request used to be able to make the server parse an
# arbitrarily large subtitle file or tree. These caps are generous for a real
# lecture but bound memory and CPU before parsing starts.
MAX_FILE_CONTENT_CHARS = 2_000_000
MAX_INITIAL_MARKDOWN_CHARS = 2_000_000
MAX_INITIAL_NODES = 2_000


class TranscriptRequest(BaseModel):
    url: str | None = Field(default=None, max_length=2048)
    file_content: str | None = Field(default=None, max_length=MAX_FILE_CONTENT_CHARS)
    # Sent when the client restores a session, so node ids survive the restart.
    initial_nodes: list[dict[str, Any]] | None = Field(
        default=None, max_length=MAX_INITIAL_NODES
    )
    initial_markdown: str | None = Field(default=None, max_length=MAX_INITIAL_MARKDOWN_CHARS)
    resume_at: float | None = None
    title: str | None = Field(default=None, max_length=500)
    # Reopen a saved project: captions and nodes come from the database.
    project_id: str | None = None
    # Switch the caption track of an already-loaded session without rebuilding
    # the map. `session_id` is required for that path.
    session_id: str | None = None
    language: str | None = Field(default=None, max_length=20)
    # The language the learner wants the MAP written in. Independent of the
    # caption track above: a Hindi transcript can produce an English map.
    output_language: str | None = Field(
        default=None,
        max_length=20,
        pattern=r"^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$",
    )
    # The thinking mode the map is built for (ADR 0013). `tree-down` is a
    # drawing of `tree`, so it never changes what the AI extracts.
    map_layout: str | None = Field(default=None, max_length=20)

class RestructureRequest(BaseModel):
    map_layout: str = Field(max_length=20)

class UpdateMapRequest(BaseModel):
    video_id: str
    last_time: float
    current_map: dict[str, Any] = {}
    session_id: str | None = None

class NodeEditRequest(BaseModel):
    session_id: str
    node_id: str
    # `None` means "leave unchanged"; the endpoint only applies provided fields.
    label: str | None = None
    note: str | None = None
    pinned: bool | None = None

sessions: dict[str, dict[str, Any]] = {}
video_cache: dict[str, dict[str, Any]] = {}

MAX_CACHED_VIDEOS = 50
SESSION_TTL_SECONDS = 2 * 60 * 60
MAX_SESSIONS = 100

CACHE_PATH = Path(__file__).resolve().parent / "data" / "video_cache.json"
CACHE_LOCK = threading.Lock()


def load_video_cache() -> None:
    try:
        if CACHE_PATH.exists():
            stored = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                video_cache.update(stored)
    except Exception:
        pass


def save_video_cache() -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = CACHE_PATH.with_suffix(".tmp")
        with CACHE_LOCK:
            tmp_path.write_text(
                json.dumps(video_cache, ensure_ascii=False),
                encoding="utf-8",
            )
            tmp_path.replace(CACHE_PATH)
    except Exception:
        pass


def cleanup_sessions() -> None:
    cleanup_asr_jobs()
    now = time.time()
    stale = [
        sid for sid, session in sessions.items()
        if now - float(session.get("last_active", now)) > SESSION_TTL_SECONDS
    ]
    for sid in stale:
        sessions.pop(sid, None)
    if len(sessions) > MAX_SESSIONS:
        ordered = sorted(
            sessions.items(),
            key=lambda item: float(item[1].get("last_active", 0.0)),
        )
        for sid, _ in ordered[: len(sessions) - MAX_SESSIONS]:
            sessions.pop(sid, None)


def touch_session(session_id: str | None) -> None:
    session = sessions.get(session_id) if session_id else None
    if session:
        session["last_active"] = time.time()


def find_project_session(project_id: str) -> str | None:
    """The live session shared by everyone currently editing a project.

    Reusing one session is what turns the existing SSE event log into realtime
    collaboration: an edit or AI diff appended by one editor is delivered to
    every other tab watching the same session.
    """
    cleanup_sessions()
    for session_id, session in sessions.items():
        if session.get("project_id") == project_id:
            return session_id
    return None


def stream_ticket_for_session(session_id: str | None, user_id: str | None) -> str | None:
    """Give a caller of the share endpoint a ticket for its live session."""
    session = sessions.get(session_id) if session_id else None
    if session is None:
        return None
    ticket, _ = stream_tickets.issue(session, user_id)
    return ticket


def project_for_session(db: Session, session: dict[str, Any]) -> Project | None:
    project_id = session.get("project_id")
    return db.get(Project, project_id) if project_id else None


def assert_can_edit_session(
    db: Session,
    session: dict[str, Any],
    user: User | None,
) -> Project | None:
    """Reject writes from viewers and from strangers on someone's session.

    A session without a project is a guest map: it may be edited by its creator
    (or anonymously, before anyone signs in). Once a session is attached to a
    saved project, the project's sharing rules decide who may write.
    """
    project = project_for_session(db, session)
    if project is None:
        owner = session.get("owner_id")
        if owner and (user is None or user.id != owner):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "session_owned_by_someone_else",
                    "message": "This working session belongs to another account.",
                },
            )
        return None

    # Even an "editor" link cannot write without an account: editing needs a
    # signed-in identity so last-write-wins has someone to attribute it to.
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "not_authenticated",
                "message": "Sign in to edit a shared project.",
            },
        )

    role = sharing_service.role_for(db, project, user)
    if role is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "project_not_found",
                "message": "That project does not exist.",
            },
        )
    if not sharing_service.can_edit(role):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "project_read_only",
                "message": "This project was shared with you as read-only.",
            },
        )
    return project


# The event loop sleeps 0.5s per tick; re-checking every 10 ticks keeps a
# revoked viewer out within ~5s without a database query on every heartbeat.
STREAM_RECHECK_TICKS = 10


def can_stream_session(db: Session, session: dict[str, Any], user_id: str | None) -> bool:
    """A live stream obeys the same access rules as the share page.

    Guest sessions have no project row; their random session id (now the ticket)
    is the capability. Project-backed streams ask the sharing service, so
    turning sharing off, deleting a project or removing a member closes them.
    """
    project = project_for_session(db, session)
    if project is None:
        return True
    user = db.get(User, user_id) if user_id else None
    return sharing_service.role_for(db, project, user) is not None


load_video_cache()
# A crash may leave a per-job mp3 behind; nothing in data/asr is needed on boot.
sweep_audio_dir()

def cache_video_map(video_id: str | None, session: dict[str, Any]) -> None:
    if not video_id:
        return
    # Signed-in maps live in the database, per user. Writing them to the shared
    # cache would leak one account's notes and pins into another account's map.
    if session.get("owner_id"):
        return
    # Uploaded subtitles and client-supplied restore data have no provenance.
    # Caching them would seed the global per-video cache with a stranger's map
    # (and an advanced AI pointer) for everyone who opens the same video later.
    if session.get("cacheable") is False:
        return
    nodes = strip_private_fields(session.get("nodes", []))
    markdown = session.get("markdown", "")
    pointer = float(session.get("consumed_until", 0.0))
    if not nodes and not markdown:
        # An empty map with an advanced pointer would tell the next visitor
        # those seconds were already mapped, so their map never rebuilds.
        if pointer > 0:
            return
        # Nor may a fresh, empty visit erase a map already in the cache.
        existing = video_cache.get(video_id)
        if existing and (existing.get("nodes") or existing.get("markdown")):
            return
    video_cache[video_id] = {
        # The tree is the source of truth; markdown is kept so an older
        # frontend or a downgraded backend can still read the cache. Guests can
        # edit notes and pins too, so the shared copy must lose those fields.
        "nodes": nodes,
        "markdown": markdown,
        "summary_so_far": session.get("summary_so_far", ""),
        "consumed_until": pointer,
        # The same video can be mapped in four modes; a session may only reuse
        # an entry built for its own mode (ADR 0013).
        "map_mode": session.get("map_mode", "tree"),
        "output_language": session.get("output_language"),
        "updated_at": time.time(),
    }
    if len(video_cache) > MAX_CACHED_VIDEOS:
        oldest = min(video_cache.items(), key=lambda item: item[1]["updated_at"])[0]
        video_cache.pop(oldest, None)
    save_video_cache()


def restore_nodes(
    initial_nodes: list[dict[str, Any]] | None,
    initial_markdown: str | None,
    cached: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Rebuild the map tree for a new session.

    New caches store the tree directly. Older caches, and clients that only
    send Markdown, are parsed back into a tree so a map is never lost because
    of the format change.
    """
    if initial_nodes:
        return normalize_cached_nodes(initial_nodes)
    if initial_markdown is not None:
        return markdown_to_tree(initial_markdown)
    if not cached:
        return []
    nodes = normalize_cached_nodes(cached.get("nodes"))
    if nodes:
        return nodes
    return markdown_to_tree(cached.get("markdown", ""))


def cache_mode(cached: dict[str, Any] | None) -> str:
    """The mode a cache entry was built for.

    Entries written before ADR 0013 have no field and are trees, which is what
    they are; `normalize_mode` also folds `tree-down` into `tree`.
    """
    return normalize_mode((cached or {}).get("map_mode") or "tree")


def create_session(
    video_id: str | None,
    transcript: list[dict[str, Any]],
    initial_markdown: str | None = None,
    resume_at: float | None = None,
    initial_nodes: list[dict[str, Any]] | None = None,
    title: str | None = None,
    language: str | None = None,
    initial_summary: str | None = None,
    owner_id: str | None = None,
    project_id: str | None = None,
    use_cache: bool = True,
    map_layout: str | None = None,
    cacheable: bool = True,
    output_language: str | None = None,
) -> tuple:
    mode = normalize_mode(map_layout)
    cached = video_cache.get(video_id) if (video_id and use_cache) else None
    # Content from another mode or another output language is not a partial map
    # of this one: ignore it and let the session rebuild from the playhead.
    if cached is not None and cache_mode(cached) != mode:
        cached = None
    if cached is not None:
        cached_language = cached.get("output_language")
        if cached_language != output_language:
            # A cached map is bytes the learner may already have studied. Keep
            # it and its own language rather than dropping it; switching is an
            # explicit, translated choice handled by /output-language.
            if cached.get("nodes") or cached.get("markdown"):
                output_language = cached_language
            else:
                cached = None

    nodes = restore_nodes(initial_nodes, initial_markdown, cached)
    markdown = tree_to_markdown(nodes) if nodes else ""

    if resume_at is not None:
        consumed_until = float(resume_at)
    elif cached:
        consumed_until = float(cached.get("consumed_until", 0.0))
        # Older cache entries can carry a pointer but no tree. Resuming there
        # leaves a session whose map can never rebuild; start from zero.
        if not nodes and consumed_until > 0:
            consumed_until = 0.0
    else:
        consumed_until = 0.0

    if initial_summary is not None:
        summary_so_far = initial_summary
    elif cached:
        summary_so_far = cached.get("summary_so_far", "")
    else:
        summary_so_far = ""

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "video_id": video_id,
        "title": title,
        "language": language,
        "output_language": output_language,
        "transcript": transcript,
        "consumed_until": consumed_until,
        "summary_so_far": summary_so_far,
        "nodes": nodes,
        "markdown": markdown,
        # The content mode the AI builds for, and the tree each visited mode
        # held, so switching back and forth is free and lossless (ADR 0013).
        "map_mode": mode,
        "maps": {mode: nodes} if nodes else {},
        "events": [],
        "last_active": time.time(),
        # Present only for signed-in sessions; autosave and resume use them.
        "owner_id": owner_id,
        "project_id": project_id,
        # Shared editors all drive the player; only one may run the AI at a time
        # or the same transcript chunk would be mapped twice.
        "update_lock": threading.Lock(),
        # Client-supplied maps must never be promoted into the shared cache.
        "cacheable": cacheable,
    }
    return session_id, bool(cached)


def session_payload(session_id: str) -> dict[str, Any]:
    session = sessions[session_id]
    return {
        "session_id": session_id,
        "nodes": session.get("nodes", []),
        "markdown": session.get("markdown", ""),
        "consumed_until": float(session.get("consumed_until", 0.0)),
        "title": session.get("title"),
        "summary": session.get("summary_so_far", ""),
        "map_mode": session.get("map_mode", "tree"),
        "output_language": session.get("output_language"),
    }

@app.get("/")
async def root():
    return {"message": "YouTube Mind Map API is running"}

@app.get("/healthz")
async def healthz():
    # A liveness probe needs one bit. Model names, proxy URLs and counters are
    # deployment details that must not be handed to an anonymous caller.
    return {"status": "ok"}

async def fetch_oembed(video_id: str) -> dict[str, Any]:
    """Public video metadata from oEmbed. A network failure returns checked=False.

    Both `/video-info` and the content gate use this one call, so a link is
    described and classified from the same answer. oEmbed has no category or
    duration, which is why the gate also looks at the caption cues.
    """

    canonical = f"https://www.youtube.com/watch?v={video_id}"
    result: dict[str, Any] = {
        "title": None,
        "author_name": None,
        "thumbnail_url": None,
        "checked": False,
        "embeddable": None,
        "reason": None,
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://www.youtube.com/oembed",
                params={"url": canonical, "format": "json"},
            )
    except Exception:
        # A transient network problem is not proof that embedding is blocked.
        return result

    result["checked"] = True
    if resp.status_code == 200:
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if isinstance(data, dict):
            result["title"] = data.get("title")
            result["author_name"] = data.get("author_name")
            result["thumbnail_url"] = data.get("thumbnail_url")
        result["embeddable"] = True
    elif resp.status_code in (400, 401, 403, 404):
        result["embeddable"] = False
        result["reason"] = "not_embeddable"
    return result


async def _fetch_youtube_title(url: str) -> str | None:
    video_id = extract_video_id(url)
    if not video_id:
        return None
    title = (await fetch_oembed(video_id)).get("title")
    return str(title) if title else None


@app.get("/video-info")
async def get_video_info(url: str):
    """Check a link without touching captions.

    oEmbed answers 200 for videos the owner allows to be embedded and
    400/401/403/404 for private, deleted, age-restricted or embed-disabled
    ones. That is the same decision the player iframe faces, so it lets the
    page show "open on YouTube" instead of a black frame.
    """

    video_id = extract_video_id(url)
    if not video_id:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_url",
                "message": "That is not a YouTube video link.",
            },
        )

    return {"video_id": video_id, **await fetch_oembed(video_id)}


async def switch_transcript_language(
    request: TranscriptRequest,
    user: User | None,
    db: Session,
) -> dict[str, Any]:
    """Replace the captions of a live session without touching the map.

    The learner may switch from an auto-generated track to a manual one (or to
    a language they read better). Nodes, notes, pins and the AI pointer stay as
    they are: the map is a study artefact, not a transcript mirror.
    """

    session = sessions.get(request.session_id) if request.session_id else None
    if session is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "session_lost",
                "message": "The study session expired. Reload the video.",
            },
        )

    # A viewer must not rewrite a shared project's captions.
    assert_can_edit_session(db, session, user)
    project = project_for_session(db, session)
    video_id = project.video_id if project is not None else session.get("video_id")
    if not video_id:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "missing_input",
                "message": "This session has no video to fetch captions for.",
            },
        )

    try:
        switched = await run_in_threadpool(
            fetch_transcript,
            f"https://www.youtube.com/watch?v={video_id}",
            request.language,
        )
        transcript, language = switched
    except TranscriptError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error

    source = (
        "youtube_manual" if getattr(switched, "generated", True) is False else "youtube_auto"
    )
    session["transcript"] = transcript
    session["language"] = language
    session["transcript_source"] = source
    session["last_active"] = time.time()

    if project is not None:
        project.transcript = transcript
        project.transcript_language = language
        project.transcript_source = source
        db.commit()

    owner_name = None
    if project is not None:
        owner = db.get(User, project.user_id)
        owner_name = owner.display_name if owner else None

    return {
        "transcript": transcript,
        "video_id": video_id,
        "title": project.title if project is not None else session.get("title"),
        "language": language,
        "transcript_source": source,
        "cached": False,
        "role": sharing_service.role_for(db, project, user) if project else None,
        "can_edit": True,
        "owner_name": owner_name,
        **session_payload(request.session_id),
    }


@app.get("/transcript/languages")
async def get_transcript_languages(url: str):
    """Caption tracks for the language picker (called on demand, not on load)."""

    try:
        items = await run_in_threadpool(list_transcript_languages, url)
    except TranscriptError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error
    return {"items": items}


@app.get("/transcript/track")
async def get_transcript_track(
    url: str, language: str = Query(min_length=2, max_length=20)
):
    """Read one caption track without switching the session's primary track.

    The bilingual view needs a second transcript next to the one the map was
    built from, so this endpoint deliberately leaves the live session alone.
    """

    try:
        entries, resolved = await run_in_threadpool(
            fetch_transcript, url, language
        )
    except TranscriptError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error
    return {"language": resolved, "transcript": entries}


def video_metadata(
    video_id: str,
    oembed: dict[str, Any],
    transcript: list[dict[str, Any]] | None = None,
    duration_seconds: float | None = None,
) -> content_policy.VideoMetadata:
    """Turn data the endpoint already has into the gate's input."""

    cues = [cue for cue in (transcript or []) if isinstance(cue, dict)]
    duration = max(
        float(duration_seconds or 0.0),
        max(
            (
                float(cue.get("start", 0.0)) + float(cue.get("duration", 0.0))
                for cue in cues
            ),
            default=0.0,
        ),
    )
    return content_policy.VideoMetadata(
        video_id=video_id,
        title=oembed.get("title") if isinstance(oembed.get("title"), str) else None,
        author_name=(
            oembed.get("author_name")
            if isinstance(oembed.get("author_name"), str)
            else None
        ),
        oembed_checked=bool(oembed.get("checked")),
        cue_count=len(cues),
        duration_seconds=duration,
    )


def content_error(decision: content_policy.Decision) -> HTTPException:
    """Maps a policy denial to the same `{code, message}` contract as captions."""

    return HTTPException(
        status_code=422,
        detail={
            "code": decision.code or "content_not_lecture",
            "message": f"Content policy: {decision.reason or 'not allowed'}",
        },
    )


async def build_session_from_cues(
    *,
    video_id: str,
    transcript: list[dict[str, Any]],
    language: str | None,
    oembed: dict[str, Any],
    title: str | None,
    source: str,
    duration_seconds: float | None = None,
    initial_markdown: str | None = None,
    resume_at: float | None = None,
    initial_nodes: list[dict[str, Any]] | None = None,
    map_layout: str | None = None,
    output_language: str | None = None,
) -> dict[str, Any]:
    """Run the unchanged two content gates and create a session from any cues.

    Caption cues and ADR 0012 audio cues go through the exact same policy and
    classifier path. A successful transcription is never itself a verdict.
    """
    label = "unverified"
    content_verified = False
    decision = content_policy.evaluate(
        video_metadata(video_id, oembed, transcript, duration_seconds)
    )
    if not decision.allowed:
        raise content_error(decision)
    label = decision.label
    # Only an explicit allowlist or the AI verdict counts as proof for layer 3.
    content_verified = decision.reason == "allowlist"

    # Layer 2: a small AI call confirms the layer-1 guess from the cue sample.
    # An allowlisted video is already trusted. Every AI failure stays
    # `unverified` and lets the learner in -- a safety net must not be a lock.
    if decision.reason != "allowlist":
        classify_title = title or (
            oembed.get("title") if isinstance(oembed.get("title"), str) else None
        )
        author_name = oembed.get("author_name")
        visuals: list[Any] = []
        if get_settings().CONTENT_VISUAL_CHECK_ENABLED:
            try:
                visuals = await run_in_threadpool(
                    video_visuals.fetch_visuals,
                    video_id,
                    duration=video_visuals.duration_from_cues(transcript),
                )
            except Exception as exc:
                logger.warning(
                    "Visual sampling failed for %s: %s", video_id, type(exc).__name__
                )
        visual_kwargs = {"visuals": visuals} if visuals else {}
        classification = await run_in_threadpool(
            content_classifier.classify,
            video_id,
            classify_title,
            author_name if isinstance(author_name, str) else None,
            transcript,
            **visual_kwargs,
        )
        ai_label = classification.get("label")
        if ai_label in ("not_lecture", "sensitive"):
            raise content_error(
                content_policy.Decision(
                    allowed=False,
                    code=(
                        "content_not_lecture"
                        if ai_label == "not_lecture"
                        else "content_sensitive"
                    ),
                    label="unverified",
                    reason=f"classifier:{ai_label}",
                )
            )
        if ai_label == "lecture":
            label = "lecture"
            content_verified = True

    # A client restoring a map sends its own nodes/markdown/pointer. Those bytes
    # are untrusted, so the session may be read but never promoted to the cache.
    restore_input = bool(initial_nodes or initial_markdown is not None or resume_at is not None)
    try:
        session_id, cached = create_session(
            video_id,
            transcript,
            initial_markdown=initial_markdown,
            resume_at=resume_at,
            initial_nodes=initial_nodes,
            title=title,
            language=language,
            map_layout=map_layout,
            cacheable=not restore_input,
            output_language=output_language,
        )
        sessions[session_id]["content_label"] = label
        sessions[session_id]["content_verified"] = content_verified
        sessions[session_id]["transcript_source"] = source
        return {
            "transcript": transcript,
            "video_id": video_id,
            "title": title,
            "language": language,
            "cached": cached,
            "content_label": label,
            "content_verified": content_verified,
            "transcript_source": source,
            **session_payload(session_id),
        }
    except Exception as e:
        logger.warning("Could not create a study session: %s", e)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "session_error",
                "message": "Không tạo được phiên học. Thử lại sau vài phút.",
            },
        ) from e


def asr_http_error(code: str) -> HTTPException:
    error = asr_error(code)
    return HTTPException(status_code=error.status_code, detail=error.detail())


async def start_asr_fallback(
    request: TranscriptRequest,
    video_id: str,
    oembed: dict[str, Any],
    user: User | None,
) -> dict[str, Any]:
    """Queue audio transcription, or serve a finished transcript from the cache."""
    settings = get_settings()
    # The flag is the first gate: with it off the old caption-only answer wins,
    # including for an anonymous visitor (ADR 0012 §1).
    if not settings.ASR_ENABLED:
        raise asr_http_error("asr_disabled")
    if user is None:
        raise asr_http_error("asr_sign_in_required")

    title = request.title or (
        oembed.get("title") if isinstance(oembed.get("title"), str) else None
    )
    if not title:
        title = await _fetch_youtube_title(request.url)

    # A finished transcript belongs to the video. Neither this learner nor a
    # second one pays for the audio again, and no quota unit is consumed.
    cached = None
    with SessionLocal() as job_db:
        cached = job_db.get(VideoTranscript, video_id)
        if cached is not None:
            cues = cached.cues or []
            language = cached.language
            duration = cached.duration_seconds
    if cached is not None:
        return await build_session_from_cues(
            video_id=video_id,
            transcript=cues,
            language=language,
            oembed=oembed,
            title=title,
            source="asr",
            duration_seconds=duration,
            initial_markdown=request.initial_markdown,
            resume_at=request.resume_at,
            initial_nodes=request.initial_nodes,
            map_layout=request.map_layout,
            output_language=request.output_language,
        )

    try:
        duration = await run_in_threadpool(probe_duration, request.url or "")
    except ASRError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail()) from exc
    if duration and duration > settings.ASR_MAX_VIDEO_SECONDS:
        raise asr_http_error("asr_too_long")
    if ai_engine.client is None:
        raise asr_http_error("asr_failed")

    allowed, _ = asr_quota.consume(
        f"asr:user:{user.id}", settings.ASR_DAILY_LIMIT_PER_USER
    )
    if not allowed:
        raise asr_http_error("asr_quota_exceeded")

    def transcriber(set_stage, should_cancel):
        return transcribe(
            request.url or "",
            client=ai_engine.client,
            model=settings.ASR_MODEL,
            bitrate=settings.ASR_AUDIO_BITRATE,
            duration=duration,
            on_stage=set_stage,
            should_cancel=should_cancel,
        )

    def finish(cues, cue_duration):
        # This runs on the job thread: it needs its own database session and its
        # own event loop, and it repeats the same gates as the caption path.
        payload = asyncio.run(
            build_session_from_cues(
                video_id=video_id,
                transcript=cues,
                language=None,
                oembed=oembed,
                title=title,
                source="asr",
                duration_seconds=cue_duration or duration,
                initial_markdown=request.initial_markdown,
                resume_at=request.resume_at,
                initial_nodes=request.initial_nodes,
                map_layout=request.map_layout,
                output_language=request.output_language,
            )
        )
        with SessionLocal() as job_db:
            if job_db.get(VideoTranscript, video_id) is None:
                job_db.add(
                    VideoTranscript(
                        video_id=video_id,
                        language=None,
                        cues=cues,
                        source="asr",
                        duration_seconds=cue_duration or duration,
                    )
                )
                try:
                    job_db.commit()
                except Exception as exc:
                    job_db.rollback()
                    logger.warning("Could not cache ASR transcript: %s", type(exc).__name__)
        return payload

    job = create_job(
        user_id=user.id,
        video_id=video_id,
        url=request.url or "",
        title=title,
        duration=duration,
        transcriber=transcriber,
        finish=finish,
    )
    return JSONResponse(
        status_code=202,
        content={
            "status": "asr_queued",
            "job_id": job["job_id"],
            "video_id": video_id,
            "title": title,
            "language": None,
            "output_language": request.output_language,
            "content_label": "unverified",
            "content_verified": False,
            "transcript_source": "asr",
            "asr": {
                "stage": "queued",
                "elapsed_seconds": 0.0,
                "max_seconds": settings.ASR_MAX_VIDEO_SECONDS,
            },
        },
    )


@app.get("/transcript/asr/{job_id}")
async def get_asr_job(
    job_id: str,
    user: User = Depends(get_current_user),
):
    cleanup_sessions()
    job = get_job(job_id, user.id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "asr_job_not_found", "message": "Không tìm thấy lượt nghe audio này."},
        )
    return job_payload(job)


@app.delete("/transcript/asr/{job_id}")
async def delete_asr_job(
    job_id: str,
    user: User = Depends(get_current_user),
):
    if not cancel_job(job_id, user.id):
        raise HTTPException(
            status_code=404,
            detail={"code": "asr_job_not_found", "message": "Không tìm thấy lượt nghe audio này."},
        )
    return {"status": "cancelled"}


@app.post("/transcript")
async def get_transcript(
    request: TranscriptRequest,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    cleanup_sessions()

    if request.language:
        return await switch_transcript_language(request, user, db)

    if request.project_id:
        # Reopening a saved map: the row is authoritative for captions, nodes,
        # notes and the AI pointer, so nothing is re-fetched from YouTube unless
        # the stored transcript is empty.
        if user is None:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "not_authenticated",
                    "message": "Sign in to open a saved project.",
                },
            )

        project = db.get(Project, request.project_id)
        role = sharing_service.role_for(db, project, user) if project else None
        if project is None or role is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "project_not_found",
                    "message": "That project does not exist.",
                },
            )

        transcript = project.transcript or []
        language = project.transcript_language
        vid = project.video_id
        title = project.title
        source = project.transcript_source or "youtube_auto"

        if not transcript and vid:
            try:
                refetched = await run_in_threadpool(
                    fetch_transcript, f"https://www.youtube.com/watch?v={vid}"
                )
                transcript, language = refetched
                source = (
                    "youtube_manual"
                    if getattr(refetched, "generated", True) is False
                    else "youtube_auto"
                )
            except TranscriptError as e:
                raise HTTPException(
                    status_code=e.status_code,
                    detail={"code": e.code, "message": e.message},
                ) from e

        # Everyone editing the same project shares one live session, so an
        # edit or AI diff from one collaborator reaches the others over SSE.
        session_id = find_project_session(project.id)
        cached = False
        if session_id is None:
            session_id, cached = create_session(
                vid,
                transcript,
                initial_nodes=project.nodes or [],
                resume_at=project.consumed_until,
                title=title,
                language=language,
                initial_summary=project.summary_so_far,
                owner_id=project.user_id,
                project_id=project.id,
                use_cache=False,
                map_layout=project.map_layout,
                cacheable=False,
                output_language=project.output_language,
            )
        else:
            touch_session(session_id)
            # A session kept alive by an open SSE stream can outlive the tree it
            # was built with. The row is authoritative: an empty live tree must
            # never be autosaved over a project that still has a map.
            live = sessions[session_id]
            if project.nodes and not live.get("nodes"):
                restored = normalize_cached_nodes(project.nodes)
                if restored:
                    live["nodes"] = restored
                    live["markdown"] = tree_to_markdown(restored)
                    live.setdefault("maps", {})[live.get("map_mode", "tree")] = restored

        # Keep the row's verdict in the live session so autosave never demotes
        # a project simply because it was reopened.
        sessions[session_id]["content_verified"] = bool(project.content_verified)
        sessions[session_id]["transcript_source"] = source
        sessions[session_id]["output_language"] = project.output_language

        project.last_opened_at = utcnow()
        db.commit()

        owner = db.get(User, project.user_id)
        return {
            "transcript": transcript,
            "video_id": vid,
            "title": title,
            "language": language,
            "transcript_source": source,
            "map_layout": project.map_layout or "tree",
            "map_palette": project.map_palette or "paper",
            "cached": cached,
            "role": role,
            "can_edit": sharing_service.can_edit(role),
            "owner_name": owner.display_name if owner else None,
            **session_payload(session_id),
        }

    if request.file_content:
        try:
            transcript = parse_vtt_or_srt(request.file_content)
            if not transcript:
                raise ValueError("No subtitle entries found in the uploaded file")
            vid = extract_video_id(request.url) if request.url else None
            title = request.title
            if not title and request.url:
                title = await _fetch_youtube_title(request.url)
            session_id, cached = create_session(
                vid,
                transcript,
                initial_markdown=request.initial_markdown,
                resume_at=request.resume_at,
                initial_nodes=request.initial_nodes,
                title=title,
                language=None,
                map_layout=request.map_layout,
                cacheable=False,
                output_language=request.output_language,
            )
            # A learner-supplied file has no provenance to confirm.
            sessions[session_id]["content_verified"] = False
            sessions[session_id]["transcript_source"] = "upload"
            return {
                "transcript": transcript,
                "video_id": vid,
                "title": title,
                "language": None,
                "transcript_source": "upload",
                "cached": cached,
                **session_payload(session_id),
            }
        except ValueError as e:
            logger.warning("Invalid uploaded subtitle: %s", e)
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_subtitle_file",
                    "message": "Không đọc được phụ đề đã tải lên. Kiểm tra lại định dạng file.",
                },
            ) from e
        except Exception as e:
            logger.warning("Could not parse uploaded subtitle: %s", e)
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_subtitle_file",
                    "message": "Không đọc được phụ đề đã tải lên. Kiểm tra lại định dạng file.",
                },
            ) from e

    if request.url:
        video_id = extract_video_id(request.url)
        oembed: dict[str, Any] = {}
        if video_id:
            # Decide what we can before fetching captions, so a blocked video
            # never reaches the transcript client, the cache or the AI.
            oembed = await fetch_oembed(video_id)
            preflight = content_policy.evaluate(
                video_metadata(video_id, oembed), check_length=False
            )
            if not preflight.allowed:
                raise content_error(preflight)

        try:
            # The YouTube client is synchronous; keeping it off the event loop
            # means one slow video no longer freezes every other request.
            result = await run_in_threadpool(fetch_transcript, request.url)
            transcript, language = result
        except TranscriptError as e:
            if (
                video_id
                and should_attempt_asr(e.code)
                and get_settings().ASR_ENABLED
            ):
                return await start_asr_fallback(request, video_id, oembed, user)
            raise HTTPException(
                status_code=e.status_code,
                detail={"code": e.code, "message": e.message},
            ) from e
        except Exception as e:
            logger.warning("Could not fetch YouTube transcript: %s", e)
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "youtube_unreachable",
                    "message": "Không lấy được phụ đề từ YouTube. Thử lại sau vài phút.",
                },
            ) from e

        if video_id:
            oembed_title = oembed.get("title")
            title = request.title or (
                oembed_title if isinstance(oembed_title, str) else None
            )
            if not title:
                title = await _fetch_youtube_title(request.url)
            return await build_session_from_cues(
                video_id=video_id,
                transcript=transcript,
                language=language,
                oembed=oembed,
                title=title,
                # A YouTube track can be human-written or generated (ADR 0012).
                source=(
                    "youtube_manual" if getattr(result, "generated", True) is False
                    else "youtube_auto"
                ),
                initial_markdown=request.initial_markdown,
                resume_at=request.resume_at,
                initial_nodes=request.initial_nodes,
                map_layout=request.map_layout,
                output_language=request.output_language,
            )

        # A bare id without oEmbed cannot be gated or titled; keep the old
        # minimal path so this input still returns a usable session.
        try:
            session_id, cached = create_session(
                video_id,
                transcript,
                initial_markdown=request.initial_markdown,
                resume_at=request.resume_at,
                initial_nodes=request.initial_nodes,
                title=request.title,
                language=language,
                map_layout=request.map_layout,
                cacheable=False,
                output_language=request.output_language,
            )
            return {
                "transcript": transcript,
                "video_id": video_id,
                "title": request.title,
                "language": language,
                "cached": cached,
                **session_payload(session_id),
            }
        except Exception as e:
            logger.warning("Could not create a study session: %s", e)
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "session_error",
                    "message": "Không tạo được phiên học. Thử lại sau vài phút.",
                },
            ) from e

    raise HTTPException(
        status_code=400,
        detail={
            "code": "missing_input",
            "message": "Either url or file_content must be provided.",
        },
    )


@app.post("/session/{session_id}/stream-ticket")
async def create_stream_ticket(
    session_id: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Mint an opaque ticket for one stream, after checking the share role."""
    cleanup_sessions()
    session = sessions.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "session_lost",
                "message": "Phiên học đã hết hạn. Mở lại dự án để tiếp tục.",
            },
        )
    allowed = can_stream_session(db, session, user.id if user else None)
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "stream_forbidden",
                "message": "Bạn không có quyền xem sơ đồ này.",
            },
        )
    ticket, expires_in = stream_tickets.issue(session, user.id if user else None)
    return {"ticket": ticket, "expires_in": expires_in}


@app.get("/stream/{ticket}")
async def stream_updates(ticket: str, db: Session = Depends(get_db)):
    cleanup_sessions()
    if stream_tickets.resolve(sessions, ticket) is None:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "stream_ticket_invalid",
                "message": "Liên kết xem trực tiếp đã hết hạn. Tải lại trang.",
            },
        )

    async def event_generator():
        last_event = 0
        ticks = 0
        while True:
            found = stream_tickets.resolve(sessions, ticket)
            if found is None:
                yield {"data": json.dumps({"type": "stream_expired"})}
                break
            _, session, record = found
            session["last_active"] = time.time()
            if ticks % STREAM_RECHECK_TICKS == 0:
                try:
                    allowed = can_stream_session(db, session, record.get("user_id"))
                except Exception:
                    logger.exception("Could not re-check SSE access")
                    allowed = False
                if not allowed:
                    yield {"data": json.dumps({"type": "access_revoked"})}
                    break
            events = session.get("events", [])
            while last_event < len(events):
                event = events[last_event]
                last_event += 1
                yield {"data": json.dumps(event.get("data", {}))}
            ticks += 1
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())

@app.post("/update-map")
async def update_map(
    request: UpdateMapRequest,
    http_request: Request,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    cleanup_sessions()
    session_id = request.session_id
    if not session_id or session_id not in sessions:
        return {
            "diff": {},
            "should_update": False,
            "reason": "session_lost",
            "session_lost": True,
            "consumed_until": 0.0,
            "chunk_size": 0,
        }

    session = sessions[session_id]
    project = assert_can_edit_session(db, session, user)
    session["last_active"] = time.time()

    # One AI call per session at a time. Every collaborator polls while the
    # video plays; without this lock the same chunk would be mapped twice.
    lock = session.get("update_lock")
    if lock is None:
        lock = threading.Lock()
        session["update_lock"] = lock
    if not lock.acquire(blocking=False):
        return {
            "diff": {},
            "should_update": False,
            "reason": "busy",
            "consumed_until": float(session.get("consumed_until", 0.0)),
            "chunk_size": 0,
        }

    try:
        transcript = session.get("transcript", [])
        last_time = float(request.last_time)
        consumed_until = float(session.get("consumed_until", 0.0))
        summary_so_far = session.get("summary_so_far", "")
        current_markdown = session.get("markdown", "")

        if not transcript:
            return {
                "diff": {},
                "should_update": False,
                "reason": "no_transcript",
                "consumed_until": consumed_until,
                "chunk_size": 0,
            }

        # Seeking backward past processed content: ignore, it is already mapped.
        if is_seek_backward(last_time, consumed_until):
            return {
                "diff": {},
                "should_update": False,
                "reason": "seek_backward",
                "consumed_until": consumed_until,
                "chunk_size": 0,
            }

        # Collect unprocessed entries up to the current position (+look-ahead),
        # capped so a large forward seek cannot create an unbounded chunk.
        chunk = select_chunk(transcript, last_time, consumed_until)

        if not chunk:
            return {
                "diff": {},
                "should_update": False,
                "reason": "no_new_chunk",
                "consumed_until": consumed_until,
                "chunk_size": 0,
            }

        time_range = chunk_time_range(chunk)

        # ADR 0017: grounding is on by default. The model repair stage is one
        # extra Gemini call, so it is charged here (the middleware charged the
        # generation call already) and degrades to deterministic-only if the
        # daily budget is spent.
        settings = get_settings()
        grounding_enabled = settings.MAP_GROUNDING_ENABLED
        use_verifier = grounding_enabled and settings.MAP_VERIFY_MODEL_ENABLED
        if use_verifier and not ai_engine.configured:
            use_verifier = False
        if use_verifier and not charge_extra_ai_unit(http_request):
            use_verifier = False

        ai_result = await asyncio.to_thread(
            ai_engine.generate_incremental_update,
            current_markdown=current_markdown,
            transcript_chunk=chunk,
            summary_so_far=summary_so_far,
            time_range=time_range,
            mode=session.get("map_mode", "tree"),
            output_language=session.get("output_language"),
        )

        # On AI failure, keep the pointer so the chunk is retried later.
        if ai_result.get("error"):
            return {
                "diff": {},
                "should_update": False,
                "reason": "ai_error",
                "error": ai_result["error"],
                "consumed_until": consumed_until,
                "chunk_size": len(chunk),
            }

        raw_nodes = ai_result.get("new_nodes") or []
        verification = {"checked": 0, "grounded": 0, "repaired": 0, "dropped": 0, "model_used": False}
        if grounding_enabled:
            outcome = await asyncio.to_thread(
                map_verifier.verify_and_repair,
                raw_nodes,
                transcript,
                use_model=use_verifier,
                language=session.get("output_language"),
                default_time=float(time_range[0]),
            )
            raw_nodes = outcome["nodes"]
            verification = outcome["stats"]
            # The diff must describe the tree we actually store, not the raw
            # model reply that still contains nodes the verifier dropped.
            markdown_diff = nodes_to_markdown(
                raw_nodes, default_time=float(time_range[0])
            )
        else:
            markdown_diff = ai_result.get("markdown_diff") or ""

        # The chunk was processed: advance even when nothing new was found,
        # otherwise the same chunk would be sent to the AI on every tick.
        new_consumed = max(consumed_until, time_range[1])
        session["consumed_until"] = new_consumed
        if ai_result.get("summary"):
            session["summary_so_far"] = ai_result["summary"]

        if ai_result.get("should_update") and markdown_diff:
            # Keep the state the AI is about to replace, so the user can roll
            # back a chunk that derails the map. Throttled inside snapshot().
            if project is not None:
                project_service.snapshot(
                    db, project, author_id=user.id if user else None
                )
            new_nodes = normalize_nodes(
                raw_nodes,
                default_time=float(time_range[0]),
            )
            session["nodes"] = merge_nodes(session.get("nodes", []), new_nodes)
            session["markdown"] = tree_to_markdown(session["nodes"])
            session.setdefault("maps", {})[session.get("map_mode", "tree")] = session["nodes"]
            cache_video_map(session.get("video_id"), session)
            event_data = {
                "type": "diff",
                "markdown_diff": markdown_diff,
                "chunk_range": time_range,
                "new_nodes": new_nodes,
                "verification": verification,
                # Full state, so a client that missed an event can resync.
                "nodes": session["nodes"],
                "markdown": session["markdown"],
                "summary": session.get("summary_so_far", ""),
            }
            session.setdefault("events", []).append(
                {"type": "diff", "data": event_data}
            )

            return {
                "diff": event_data,
                "should_update": True,
                "consumed_until": new_consumed,
                "summary": session.get("summary_so_far", ""),
                "verification": verification,
            }

        cache_video_map(session.get("video_id"), session)
        return {
            "diff": {},
            "should_update": False,
            "reason": "no_new_content",
            "consumed_until": new_consumed,
            "chunk_size": len(chunk),
            "summary": session.get("summary_so_far", ""),
            "verification": verification,
        }
    finally:
        lock.release()

def apply_translated_labels(
    current: list[dict[str, Any]], translated: list[Any]
) -> None:
    """Copy translated labels onto the stored tree, keeping learner state.

    The model is asked to keep the shape exactly; a mismatch means its answer
    is unusable and the caller must leave the existing map untouched.
    """

    if len(current) != len(translated):
        raise ValueError("translated tree has a different shape")
    for node, raw in zip(current, translated, strict=True):
        if not isinstance(node, dict) or not isinstance(raw, dict):
            raise ValueError("invalid translated node")
        label = str(
            raw.get("name") or raw.get("title") or raw.get("label") or ""
        ).strip()[:200]
        if not label:
            raise ValueError("translated node has no label")
        node["label"] = label
        old_children = node.get("children") or []
        new_children = raw.get("children") or []
        apply_translated_labels(old_children, new_children)


@app.post("/output-language")
async def set_output_language(
    request: OutputLanguageRequest,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Choose the language the mind map is written in.

    Captions stay in their own language. On a map that already has content,
    switching the study language translates the existing labels and summary in
    one bounded AI call; a failed call leaves the old map intact.
    """

    cleanup_sessions()
    session = sessions.get(request.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session_lost")

    attached_id = session.get("project_id")
    if request.project_id and attached_id and request.project_id != attached_id:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "project_mismatch",
                "message": "This session belongs to a different project.",
            },
        )
    project_id = request.project_id or attached_id
    project = db.get(Project, project_id) if project_id else None
    if project is not None:
        if user is None:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "not_authenticated",
                    "message": "Sign in to change a saved project's language.",
                },
            )
        role = sharing_service.role_for(db, project, user)
        if role is None:
            raise HTTPException(status_code=404, detail="project_not_found")
        if not sharing_service.can_edit(role):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "project_read_only",
                    "message": "This project was shared with you as read-only.",
                },
            )
    else:
        assert_can_edit_session(db, session, user)

    previous = session.get("output_language")
    requested = request.output_language
    if previous == requested:
        return {
            "output_language": previous,
            "nodes": session.get("nodes", []),
            "markdown": session.get("markdown", ""),
            "summary": session.get("summary_so_far", ""),
            "changed": False,
            "translated": False,
        }

    markdown = (session.get("markdown") or "").strip()
    if requested is None:
        if markdown:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "rebuild_required",
                    "message": "Đổi về theo phụ đề cần tạo lại sơ đồ hiện tại.",
                },
            )
        session["output_language"] = None
        if project is not None:
            project.output_language = None
            db.commit()
        return {
            "output_language": None,
            "nodes": session.get("nodes", []),
            "markdown": session.get("markdown", ""),
            "summary": session.get("summary_so_far", ""),
            "changed": True,
            "translated": False,
        }

    translated = False
    if markdown:
        if len(markdown) > MAX_RESTRUCTURE_CHARS:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "map_too_large",
                    "message": "Sơ đồ này quá lớn để dịch trong một lần.",
                },
            )
        lock = session.get("update_lock")
        if lock is None:
            lock = threading.Lock()
            session["update_lock"] = lock
        if not lock.acquire(blocking=False):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "busy",
                    "message": "Đang cập nhật sơ đồ, thử lại sau vài giây.",
                },
            )
        try:
            outcome = await asyncio.to_thread(
                ai_engine.relabel,
                markdown,
                requested,
                session.get("summary_so_far", ""),
            )
        finally:
            lock.release()

        if (
            outcome.get("error")
            or outcome.get("note")
            or not isinstance(outcome.get("nodes"), list)
            or not outcome["nodes"]
        ):
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "ai_error",
                    "message": "Không dịch được sơ đồ. Ngôn ngữ học vẫn giữ nguyên.",
                },
            )
        if outcome.get("summary") is None:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "ai_error",
                    "message": "Không dịch được phần tóm tắt. Sơ đồ vẫn giữ nguyên.",
                },
            )
        try:
            apply_translated_labels(session.get("nodes", []), outcome["nodes"])
        except ValueError:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "ai_error",
                    "message": "Kết quả dịch không khớp sơ đồ. Sơ đồ vẫn giữ nguyên.",
                },
            ) from None

        if project is not None:
            project_service.snapshot(db, project, author_id=user.id if user else None)
        session["markdown"] = tree_to_markdown(session["nodes"])
        session["summary_so_far"] = outcome["summary"]
        translated = True

    session["output_language"] = requested
    if project is not None:
        project.output_language = requested
        db.commit()
        db.refresh(project)

    cache_video_map(session.get("video_id"), session)
    payload = {
        "type": "output_language",
        "nodes": session.get("nodes", []),
        "markdown": session.get("markdown", ""),
        "summary": session.get("summary_so_far", ""),
        "output_language": requested,
        "translated": translated,
    }
    session.setdefault("events", []).append({"type": "output_language", "data": payload})
    return {**payload, "changed": True}


@app.post("/session/{session_id}/restructure")
async def restructure_map(
    session_id: str,
    request: RestructureRequest,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Rewrite the map for another thinking mode (ADR 0013).

    One AI call reorganises what the map already holds. Modes the session has
    visited before are restored from memory, and a mode that is only a drawing
    of the current one (`tree` ↔ `tree-down`) changes nothing.
    """
    cleanup_sessions()
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session_lost")

    project = assert_can_edit_session(db, session, user)
    session["last_active"] = time.time()
    target = normalize_mode(request.map_layout)
    current = session.get("map_mode", "tree")
    maps = session.setdefault("maps", {})

    def payload(changed: bool, **extra: Any) -> dict[str, Any]:
        return {
            "nodes": session.get("nodes", []),
            "markdown": session.get("markdown", ""),
            "map_mode": session.get("map_mode", "tree"),
            "changed": changed,
            **extra,
        }

    if target == current:
        return payload(False, reason="same_mode")

    def adopt(nodes: list[dict[str, Any]], restored: bool) -> dict[str, Any]:
        session["nodes"] = nodes
        session["markdown"] = tree_to_markdown(nodes)
        session["map_mode"] = target
        maps[target] = nodes
        cache_video_map(session.get("video_id"), session)
        event = {
            "type": "restructure",
            "nodes": nodes,
            "markdown": session["markdown"],
            "map_mode": target,
        }
        session.setdefault("events", []).append({"type": "restructure", "data": event})
        return payload(True, restored=restored)

    # A mode visited earlier is still in memory, so switching back is free and
    # loses nothing. Only the persisted project keeps the current mode.
    remembered = maps.get(target)
    if remembered is not None:
        return adopt(remembered, restored=True)

    markdown = (session.get("markdown") or "").strip()
    if not markdown:
        # Nothing has been extracted yet: the next chunk is already built for
        # the new mode, so this costs nothing.
        session["map_mode"] = target
        maps[target] = session.get("nodes", [])
        return payload(True, restored=False)

    if len(markdown) > MAX_RESTRUCTURE_CHARS:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "map_too_large",
                "message": "Sơ đồ này quá lớn để tạo lại nội dung trong một lần.",
            },
        )

    lock = session.get("update_lock")
    if lock is None:
        lock = threading.Lock()
        session["update_lock"] = lock
    if not lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "busy",
                "message": "Đang cập nhật sơ đồ, thử lại sau vài giây.",
            },
        )
    try:
        language = session.get("output_language")
        outcome = (
            await asyncio.to_thread(
                ai_engine.restructure, markdown, target, language
            )
            if language
            else await asyncio.to_thread(ai_engine.restructure, markdown, target)
        )
    finally:
        lock.release()

    if outcome.get("error") or outcome.get("note"):
        raise HTTPException(
            status_code=502,
            detail={
                "code": "ai_error",
                "message": "Không tạo lại được nội dung. Sơ đồ vẫn giữ nguyên.",
            },
        )

    # ADR 0017: a restructure keeps the timestamps, so the caption evidence can
    # be carried over without another verification or model call.
    restructured = map_verifier.carry_evidence(
        session.get("nodes", []), outcome.get("nodes") or []
    )
    nodes = normalize_nodes(restructured)
    if not nodes:
        # An empty reply must never replace a map the learner already has.
        raise HTTPException(
            status_code=502,
            detail={
                "code": "ai_error",
                "message": "Không tạo lại được nội dung. Sơ đồ vẫn giữ nguyên.",
            },
        )

    if project is not None:
        project_service.snapshot(db, project, author_id=user.id if user else None)

    maps[current] = session.get("nodes", [])
    return adopt(nodes, restored=False)

@app.patch("/node")
async def edit_node(
    request: NodeEditRequest,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Rename a node, attach a note, or pin it.

    Structure belongs to the AI (and to merge_nodes); this endpoint only edits
    a node that already exists. The whole tree comes back so the caller can
    replace its copy instead of patching it locally.
    """
    cleanup_sessions()
    session = sessions.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session_lost")

    assert_can_edit_session(db, session, user)

    provided = request.model_dump(exclude_unset=True)
    if not {"label", "note", "pinned"} & provided.keys():
        raise HTTPException(status_code=400, detail="no fields to update")

    try:
        node = update_node(
            session.get("nodes", []),
            request.node_id,
            label=request.label,
            note=request.note,
            pinned=request.pinned,
        )
    except ValueError as e:
        logger.warning("Invalid node update: %s", e)
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_node",
                "message": "label must not be empty",
            },
        ) from e

    if node is None:
        raise HTTPException(status_code=404, detail="node_not_found")

    session["last_active"] = time.time()
    session["markdown"] = tree_to_markdown(session.get("nodes", []))
    cache_video_map(session.get("video_id"), session)

    # Other tabs on the same session converge through the stream.
    event_data = {
        "type": "node_edit",
        "node_id": node["id"],
        "nodes": session["nodes"],
        "markdown": session["markdown"],
    }
    session.setdefault("events", []).append({"type": "node_edit", "data": event_data})

    return {
        "node": node,
        "nodes": session["nodes"],
        "markdown": session["markdown"],
    }

@app.post("/api/projects/autosave")
def autosave_project(
    request: AutosaveRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the live session as a draft (or update an existing project).

    Lives here, not in the projects router, because the in-memory session is
    owned by this module. The browser sends only ids, never the transcript.
    """

    session = sessions.get(request.session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "session_lost",
                "message": "The working session expired before it could be saved.",
            },
        )

    # A shared session may be attached to a project the caller does not own.
    # Resolve the project first so an editor can save into it while a viewer is
    # rejected. ``request.project_id`` wins, but it may not point somewhere
    # other than the project the session is already bound to.
    attached_id = session.get("project_id")
    target_id = request.project_id or attached_id
    if attached_id and request.project_id and attached_id != request.project_id:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "project_mismatch",
                "message": "This session belongs to a different project.",
            },
        )

    project = db.get(Project, target_id) if target_id else None

    if project is not None:
        role = sharing_service.role_for(db, project, user)
        if role is None:
            owner_id = session.get("owner_id")
            if owner_id and owner_id != user.id:
                raise HTTPException(
                    status_code=403, detail="session_owned_by_someone_else"
                )
            raise HTTPException(status_code=404, detail="project_not_found")
        if not sharing_service.can_edit(role):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "project_read_only",
                    "message": "This project was shared with you as read-only.",
                },
            )

        # The session keeps the owner's id so the shared video cache stays off
        # and later editors are still checked against the same project.
        session["owner_id"] = project.user_id
        session["project_id"] = project.id
        session["editor_id"] = user.id
        saved = project_service.save_session(
            db,
            project,
            session,
            # Only the owner may rename the project.
            title=request.title if role == sharing_service.ROLE_OWNER else None,
            author_id=user.id,
        )
        # Style is presentation, not content, so an editor may change it even
        # though they cannot rename the project.
        if project_service.apply_style(
            saved, request.map_layout, request.map_palette
        ):
            db.commit()
            db.refresh(saved)
        return project_service.summary(saved)

    if target_id:
        raise HTTPException(status_code=404, detail="project_not_found")

    owner = session.get("owner_id")
    if owner and owner != user.id:
        raise HTTPException(status_code=403, detail="session_owned_by_someone_else")

    # A guest map becomes the signed-in user's project on the first autosave.
    session["owner_id"] = user.id
    session["editor_id"] = user.id

    project = project_service.autosave(
        db,
        user.id,
        session,
        project_id=request.project_id,
        title=request.title,
        is_draft=request.is_draft,
        map_layout=request.map_layout,
        map_palette=request.map_palette,
    )
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project_service.summary(project)


def _project_for_user(db: Session, user: User, project_id: str) -> tuple[Project, str]:
    """Resolve a project the caller can at least read, plus their role."""
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="project_not_found")
    role = sharing_service.role_for(db, project, user)
    if role is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project, role


@app.get("/api/projects/{project_id}/versions")
def list_project_versions(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project, _ = _project_for_user(db, user, project_id)
    return {
        "items": [
            project_service.version_payload(version)
            for version in project_service.list_versions(db, project.id)
        ]
    }


@app.get("/api/projects/{project_id}/versions/{version_id}")
def get_project_version(
    project_id: str,
    version_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project, _ = _project_for_user(db, user, project_id)
    version = project_service.get_version(db, project.id, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="version_not_found")
    return project_service.version_payload(version, with_nodes=True)


@app.post("/api/projects/{project_id}/versions/{version_id}/restore")
def restore_project_version(
    project_id: str,
    version_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Roll the map back and push the restored tree to every open tab."""
    project, role = _project_for_user(db, user, project_id)
    if not sharing_service.can_edit(role):
        raise HTTPException(status_code=403, detail="project_read_only")
    version = project_service.get_version(db, project.id, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="version_not_found")

    project_service.restore_version(db, project, version, author_id=user.id)

    session_id = find_project_session(project.id)
    if session_id:
        session = sessions[session_id]
        session["nodes"] = project.nodes
        session["markdown"] = tree_to_markdown(project.nodes or [])
        session["summary_so_far"] = project.summary_so_far or ""
        session["consumed_until"] = float(project.consumed_until or 0.0)
        session["last_active"] = time.time()
        session.setdefault("events", []).append(
            {
                "type": "restore",
                "data": {
                    "type": "restore",
                    "nodes": session["nodes"],
                    "markdown": session["markdown"],
                    "summary": session["summary_so_far"],
                },
            }
        )

    return {
        **project_service.detail(project),
        "restored_version_id": version.id,
        "session_id": session_id,
    }
