from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from transcript import fetch_transcript, extract_video_id
from sse_starlette.sse import EventSourceResponse
from ai_engine import ai_engine
import asyncio
import json
import threading
import time
import uuid

app = FastAPI(title="YouTube Mind Map API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranscriptRequest(BaseModel):
    url: Optional[str] = None
    file_content: Optional[str] = None
    initial_markdown: Optional[str] = None
    resume_at: Optional[float] = None

class UpdateMapRequest(BaseModel):
    video_id: str
    last_time: float
    current_map: Dict[str, Any] = {}
    session_id: Optional[str] = None

sessions: Dict[str, Dict[str, Any]] = {}
video_cache: Dict[str, Dict[str, Any]] = {}

MAX_CHUNK_SECONDS = 180.0
LOOKAHEAD_SECONDS = 2.0
MAX_CHUNK_ENTRIES = 300
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


def touch_session(session_id: Optional[str]) -> None:
    session = sessions.get(session_id) if session_id else None
    if session:
        session["last_active"] = time.time()


load_video_cache()

def parse_vtt_or_srt(content: str) -> List[Dict[str, Any]]:
    lines = content.splitlines()
    entries = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if '-->' in line:
            try:
                parts = line.split('-->')
                start = parts[0].strip().replace(',', '.')
                end = parts[1].strip().split()[0].replace(',', '.') if len(parts) > 1 else start
                def to_seconds(ts: str) -> float:
                    components = ts.split(':')
                    if len(components) == 3:
                        h, m, s = components
                    elif len(components) == 2:
                        h, m, s = 0, components[0], components[1]
                    else:
                        try:
                            return float(ts)
                        except:
                            return 0
                    return float(h)*3600 + float(m)*60 + float(s)
                i += 1
                text_parts = []
                while i < len(lines) and lines[i].strip():
                    text_parts.append(lines[i].strip())
                    i += 1
                text = ' '.join(text_parts)
                if text:
                    entries.append({
                        'start': to_seconds(start),
                        'duration': max(0, to_seconds(end) - to_seconds(start)),
                        'text': text
                    })
            except Exception:
                pass
        i += 1
    return entries

def cache_video_map(video_id: Optional[str], session: Dict[str, Any]) -> None:
    if not video_id:
        return
    video_cache[video_id] = {
        "markdown": session.get("markdown", ""),
        "summary_so_far": session.get("summary_so_far", ""),
        "consumed_until": float(session.get("consumed_until", 0.0)),
        "updated_at": time.time(),
    }
    if len(video_cache) > MAX_CACHED_VIDEOS:
        oldest = min(video_cache.items(), key=lambda item: item[1]["updated_at"])[0]
        video_cache.pop(oldest, None)
    save_video_cache()


def create_session(
    video_id: Optional[str],
    transcript: List[Dict[str, Any]],
    initial_markdown: Optional[str] = None,
    resume_at: Optional[float] = None,
) -> tuple:
    cached = video_cache.get(video_id) if video_id else None

    if initial_markdown is not None:
        markdown = initial_markdown.strip()
    elif cached:
        markdown = cached.get("markdown", "")
    else:
        markdown = ""

    if resume_at is not None:
        consumed_until = float(resume_at)
    elif cached:
        consumed_until = float(cached.get("consumed_until", 0.0))
    else:
        consumed_until = 0.0

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "video_id": video_id,
        "transcript": transcript,
        "consumed_until": consumed_until,
        "summary_so_far": cached.get("summary_so_far", "") if cached else "",
        "current_map": {"name": "root", "children": []},
        "markdown": markdown,
        "events": [],
        "last_active": time.time(),
    }
    return session_id, bool(cached)


def session_payload(session_id: str) -> Dict[str, Any]:
    session = sessions[session_id]
    return {
        "session_id": session_id,
        "markdown": session.get("markdown", ""),
        "consumed_until": float(session.get("consumed_until", 0.0)),
    }

@app.get("/")
async def root():
    return {"message": "YouTube Mind Map API is running"}

@app.post("/transcript")
async def get_transcript(request: TranscriptRequest):
    cleanup_sessions()
    if request.file_content:
        try:
            transcript = parse_vtt_or_srt(request.file_content)
            if not transcript:
                raise ValueError("No subtitle entries found in the uploaded file")
            vid = extract_video_id(request.url) if request.url else None
            session_id, cached = create_session(
                vid,
                transcript,
                initial_markdown=request.initial_markdown,
                resume_at=request.resume_at
            )
            return {
                "transcript": transcript,
                "video_id": vid,
                "cached": cached,
                **session_payload(session_id),
            }
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse transcript: {str(e)}")
    
    if request.url:
        try:
            transcript = fetch_transcript(request.url)
            vid = extract_video_id(request.url)
            session_id, cached = create_session(
                vid,
                transcript,
                initial_markdown=request.initial_markdown,
                resume_at=request.resume_at
            )
            return {
                "transcript": transcript,
                "video_id": vid,
                "cached": cached,
                **session_payload(session_id),
            }
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch transcript: {str(e)}")
    
    raise HTTPException(status_code=400, detail="Either url or file_content must be provided")

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
async def update_map(request: UpdateMapRequest):
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
    session["last_active"] = time.time()
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
    if last_time + LOOKAHEAD_SECONDS + 1.0 < consumed_until:
        return {
            "diff": {},
            "should_update": False,
            "reason": "seek_backward",
            "consumed_until": consumed_until,
            "chunk_size": 0,
        }

    # Collect unprocessed entries up to the current position (+small look-ahead),
    # capped so a large forward seek cannot create an unbounded chunk.
    window_end = last_time + LOOKAHEAD_SECONDS
    window_limit = consumed_until + MAX_CHUNK_SECONDS
    chunk = []
    for entry in transcript:
        start = float(entry.get("start", 0) or 0)
        if start <= consumed_until + 0.1:
            continue
        if start > window_end or start > window_limit:
            break
        chunk.append(entry)
        if len(chunk) >= MAX_CHUNK_ENTRIES:
            break

    if not chunk:
        return {
            "diff": {},
            "should_update": False,
            "reason": "no_new_chunk",
            "consumed_until": consumed_until,
            "chunk_size": 0,
        }

    chunk_start = min(float(c.get("start", 0) or 0) for c in chunk)
    chunk_end = max(
        float(c.get("start", 0) or 0) + float(c.get("duration", 0) or 0)
        for c in chunk
    )
    time_range = (chunk_start, chunk_end)

    ai_result = await asyncio.to_thread(
        ai_engine.generate_incremental_update,
        current_markdown=current_markdown,
        transcript_chunk=chunk,
        summary_so_far=summary_so_far,
        time_range=time_range
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
    new_consumed = max(consumed_until, chunk_end)
    session["consumed_until"] = new_consumed
    if ai_result.get("summary"):
        session["summary_so_far"] = ai_result["summary"]

    if ai_result.get("should_update") and ai_result.get("markdown_diff"):
        session["markdown"] = (current_markdown + "\n" + ai_result["markdown_diff"]).strip()
        cache_video_map(session.get("video_id"), session)
        event_data = {
            "type": "diff",
            "markdown_diff": ai_result["markdown_diff"],
            "chunk_range": time_range,
            "new_nodes": ai_result.get("new_nodes", [])
        }
        session.setdefault("events", []).append({"type": "diff", "data": event_data})

        return {
            "diff": event_data,
            "should_update": True,
            "consumed_until": new_consumed
        }

    cache_video_map(session.get("video_id"), session)
    return {
        "diff": {},
        "should_update": False,
        "reason": "no_new_content",
        "consumed_until": new_consumed,
        "chunk_size": len(chunk)
    }
