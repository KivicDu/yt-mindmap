from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import asyncio
import json
import os
import threading
import time
import uuid
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from ai_engine import ai_engine
from app.api.deps import get_current_user, get_optional_user
from app.api.router import api_router
from app.db.base import utcnow
from app.db.session import get_db
from app.middleware.rate_limit import RateLimitMiddleware
from app.models.project import Project
from app.models.user import User
from app.schemas.project import AutosaveRequest
from app.services import projects as project_service
from app.services import sharing as sharing_service
from chunking import chunk_time_range, is_seek_backward, select_chunk
from node_tree import (
    markdown_to_tree,
    merge_nodes,
    normalize_cached_nodes,
    normalize_nodes,
    tree_to_markdown,
    update_node,
)
from subtitles import parse_vtt_or_srt
from transcript import TranscriptError, extract_video_id, fetch_transcript

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

class TranscriptRequest(BaseModel):
    url: str | None = None
    file_content: str | None = None
    # Sent when the client restores a session, so node ids survive the restart.
    initial_nodes: list[dict[str, Any]] | None = None
    initial_markdown: str | None = None
    resume_at: float | None = None
    title: str | None = None
    # Reopen a saved project: captions and nodes come from the database.
    project_id: str | None = None

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


load_video_cache()

def cache_video_map(video_id: str | None, session: dict[str, Any]) -> None:
    if not video_id:
        return
    # Signed-in maps live in the database, per user. Writing them to the shared
    # cache would leak one account's notes and pins into another account's map.
    if session.get("owner_id"):
        return
    video_cache[video_id] = {
        # The tree is the source of truth; markdown is kept so an older
        # frontend or a downgraded backend can still read the cache.
        "nodes": session.get("nodes", []),
        "markdown": session.get("markdown", ""),
        "summary_so_far": session.get("summary_so_far", ""),
        "consumed_until": float(session.get("consumed_until", 0.0)),
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
) -> tuple:
    cached = video_cache.get(video_id) if (video_id and use_cache) else None

    nodes = restore_nodes(initial_nodes, initial_markdown, cached)
    markdown = tree_to_markdown(nodes) if nodes else ""

    if resume_at is not None:
        consumed_until = float(resume_at)
    elif cached:
        consumed_until = float(cached.get("consumed_until", 0.0))
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
        "transcript": transcript,
        "consumed_until": consumed_until,
        "summary_so_far": summary_so_far,
        "nodes": nodes,
        "markdown": markdown,
        "events": [],
        "last_active": time.time(),
        # Present only for signed-in sessions; autosave and resume use them.
        "owner_id": owner_id,
        "project_id": project_id,
        # Shared editors all drive the player; only one may run the AI at a time
        # or the same transcript chunk would be mapped twice.
        "update_lock": threading.Lock(),
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
    }

@app.get("/")
async def root():
    return {"message": "YouTube Mind Map API is running"}

@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "sessions": len(sessions),
        "cached_videos": len(video_cache),
        "ai_configured": ai_engine.configured,
        "ai_model": ai_engine.model_name,
        # Empty unless GEMINI_BASE_URL points at a mock or proxy.
        "ai_base_url": ai_engine.base_url,
        "ai_tokens": dict(ai_engine.usage_totals),
    }

async def _fetch_youtube_title(url: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://www.youtube.com/oembed",
                params={"url": url, "format": "json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict) and data.get("title"):
                    return str(data["title"])
    except Exception:
        pass
    return None


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

    canonical = f"https://www.youtube.com/watch?v={video_id}"
    result: dict[str, Any] = {
        "video_id": video_id,
        "title": None,
        "author_name": None,
        "thumbnail_url": None,
        "embeddable": None,
        "checked": False,
        "reason": None,
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://www.youtube.com/oembed",
                params={"url": canonical, "format": "json"},
            )
    except Exception:
        # A transient network problem is not proof that embedding is blocked;
        # leave embeddable as None so the player still gets a chance.
        return result

    result["checked"] = True
    if resp.status_code == 200:
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if isinstance(data, dict):
            result.update(
                {
                    "title": data.get("title"),
                    "author_name": data.get("author_name"),
                    "thumbnail_url": data.get("thumbnail_url"),
                }
            )
        result["embeddable"] = True
        return result

    if resp.status_code in (400, 401, 403, 404):
        result["embeddable"] = False
        result["reason"] = "not_embeddable"
        return result

    return result


@app.post("/transcript")
async def get_transcript(
    request: TranscriptRequest,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    cleanup_sessions()

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

        if not transcript and vid:
            try:
                transcript, language = await run_in_threadpool(
                    fetch_transcript, f"https://www.youtube.com/watch?v={vid}"
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
            )
        else:
            touch_session(session_id)

        project.last_opened_at = utcnow()
        db.commit()

        owner = db.get(User, project.user_id)
        return {
            "transcript": transcript,
            "video_id": vid,
            "title": title,
            "language": language,
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
            )
            return {
                "transcript": transcript,
                "video_id": vid,
                "title": title,
                "language": None,
                "cached": cached,
                **session_payload(session_id),
            }
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_subtitle_file", "message": str(e)},
            ) from e
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "invalid_subtitle_file",
                    "message": f"Failed to parse transcript: {str(e)}",
                },
            ) from e

    if request.url:
        try:
            # The YouTube client is synchronous; keeping it off the event loop
            # means one slow video no longer freezes every other request.
            transcript, language = await run_in_threadpool(
                fetch_transcript, request.url
            )
        except TranscriptError as e:
            raise HTTPException(
                status_code=e.status_code,
                detail={"code": e.code, "message": e.message},
            ) from e
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail={
                    "code": "youtube_unreachable",
                    "message": f"Failed to fetch transcript: {str(e)}",
                },
            ) from e

        try:
            vid = extract_video_id(request.url)
            title = request.title or await _fetch_youtube_title(request.url)
            session_id, cached = create_session(
                vid,
                transcript,
                initial_markdown=request.initial_markdown,
                resume_at=request.resume_at,
                initial_nodes=request.initial_nodes,
                title=title,
                language=language,
            )
            return {
                "transcript": transcript,
                "video_id": vid,
                "title": title,
                "language": language,
                "cached": cached,
                **session_payload(session_id),
            }
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "session_error",
                    "message": f"Could not create the session: {str(e)}",
                },
            ) from e

    raise HTTPException(
        status_code=400,
        detail={
            "code": "missing_input",
            "message": "Either url or file_content must be provided.",
        },
    )


@app.get("/stream/{session_id}")
async def stream_updates(session_id: str):
    cleanup_sessions()

    async def event_generator():
        last_event = 0
        while True:
            session = sessions.get(session_id)
            if not session:
                yield {"data": json.dumps({"type": "session_lost"})}
                break
            session["last_active"] = time.time()
            events = session.get("events", [])
            while last_event < len(events):
                event = events[last_event]
                last_event += 1
                yield {
                    "data": json.dumps(event.get("data", {}))
                }
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())

@app.post("/update-map")
async def update_map(
    request: UpdateMapRequest,
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
    assert_can_edit_session(db, session, user)
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

        ai_result = await asyncio.to_thread(
            ai_engine.generate_incremental_update,
            current_markdown=current_markdown,
            transcript_chunk=chunk,
            summary_so_far=summary_so_far,
            time_range=time_range,
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

        # The chunk was processed: advance even when nothing new was found,
        # otherwise the same chunk would be sent to the AI on every tick.
        new_consumed = max(consumed_until, time_range[1])
        session["consumed_until"] = new_consumed
        if ai_result.get("summary"):
            session["summary_so_far"] = ai_result["summary"]

        if ai_result.get("should_update") and ai_result.get("markdown_diff"):
            new_nodes = normalize_nodes(
                ai_result.get("new_nodes") or [],
                default_time=float(time_range[0]),
            )
            session["nodes"] = merge_nodes(session.get("nodes", []), new_nodes)
            session["markdown"] = tree_to_markdown(session["nodes"])
            cache_video_map(session.get("video_id"), session)
            event_data = {
                "type": "diff",
                "markdown_diff": ai_result["markdown_diff"],
                "chunk_range": time_range,
                "new_nodes": new_nodes,
                # Full state, so a client that missed an event can resync.
                "nodes": session["nodes"],
                "markdown": session["markdown"],
            }
            session.setdefault("events", []).append(
                {"type": "diff", "data": event_data}
            )

            return {
                "diff": event_data,
                "should_update": True,
                "consumed_until": new_consumed,
            }

        cache_video_map(session.get("video_id"), session)
        return {
            "diff": {},
            "should_update": False,
            "reason": "no_new_content",
            "consumed_until": new_consumed,
            "chunk_size": len(chunk),
        }
    finally:
        lock.release()

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
        raise HTTPException(status_code=400, detail=str(e)) from e

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
        saved = project_service.save_session(
            db,
            project,
            session,
            # Only the owner may rename the project.
            title=request.title if role == sharing_service.ROLE_OWNER else None,
        )
        return project_service.summary(saved)

    if target_id:
        raise HTTPException(status_code=404, detail="project_not_found")

    owner = session.get("owner_id")
    if owner and owner != user.id:
        raise HTTPException(status_code=403, detail="session_owned_by_someone_else")

    # A guest map becomes the signed-in user's project on the first autosave.
    session["owner_id"] = user.id

    project = project_service.autosave(
        db,
        user.id,
        session,
        project_id=request.project_id,
        title=request.title,
        is_draft=request.is_draft,
    )
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project_service.summary(project)
