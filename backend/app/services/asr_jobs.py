"""In-memory job store for audio transcription (ADR 0012).

The app is a single uvicorn worker, like the session store in ``main.py``. A
restart loses in-flight jobs; that is accepted, and the finished-transcript
cache makes a retry cheap. Jobs are keyed by UUID and carry ``user_id`` so only
the owner can read or cancel them.
"""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

asr_jobs: dict[str, dict[str, Any]] = {}

# Bound the number of simultaneous downloads/model calls. Extra jobs wait in
# `queued` without spending anything.
_concurrency = threading.Semaphore(max(1, get_settings().ASR_MAX_CONCURRENCY))

TERMINAL_STAGES = frozenset({"ready", "failed", "cancelled"})


def reset_asr_jobs() -> None:
    """Clear the store (tests and local development reloads)."""
    asr_jobs.clear()


def sweep_audio_dir(data_dir: str | Path | None = None) -> None:
    """Remove orphaned per-job audio folders left by a previous process."""
    root = Path(data_dir) if data_dir is not None else Path(__file__).resolve().parents[2] / "data"
    directory = root / "asr"
    if not directory.exists():
        return
    for child in directory.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)


def create_job(
    *,
    user_id: str,
    video_id: str | None,
    url: str,
    title: str | None,
    duration: float | None,
    transcriber: Callable[
        [Callable[[str], None], Callable[[], bool]], tuple[list[dict[str, Any]], float | None]
    ],
    finish: Callable[[list[dict[str, Any]], float | None], dict[str, Any]],
) -> dict[str, Any]:
    job: dict[str, Any] = {
        "job_id": str(uuid.uuid4()),
        "user_id": user_id,
        "video_id": video_id,
        "url": url,
        "title": title,
        "stage": "queued",
        "status": "queued",
        "elapsed_seconds": 0.0,
        "audio_seconds": duration,
        "error": None,
        "session": None,
        "created_at": time.monotonic(),
        "started_at": None,
        "finished_at": None,
        "cancelled": False,
    }
    asr_jobs[job["job_id"]] = job
    threading.Thread(
        target=_run_job,
        args=(job, transcriber, finish),
        name=f"asr-{job['job_id'][:8]}",
        daemon=True,
    ).start()
    return job


def get_job(job_id: str, user_id: str) -> dict[str, Any] | None:
    job = asr_jobs.get(job_id)
    return job if job is not None and job["user_id"] == user_id else None


def cancel_job(job_id: str, user_id: str) -> bool:
    """Mark an unfinished job cancelled. The worker checks the flag at each step."""
    job = get_job(job_id, user_id)
    if job is None or job["stage"] in TERMINAL_STAGES:
        return False
    job["cancelled"] = True
    job["stage"] = "cancelled"
    job["status"] = "cancelled"
    job["finished_at"] = time.monotonic()
    return True


def cleanup_asr_jobs() -> None:
    """Drop jobs that finished longer than the configured TTL ago."""
    ttl = get_settings().ASR_JOB_TTL_SECONDS
    now = time.monotonic()
    stale = [
        job_id
        for job_id, job in asr_jobs.items()
        if job.get("finished_at") is not None and now - float(job["finished_at"]) > ttl
    ]
    for job_id in stale:
        asr_jobs.pop(job_id, None)


def job_payload(job: dict[str, Any]) -> dict[str, Any]:
    """The poll response shape; `session` is only sent for a finished job."""
    payload: dict[str, Any] = {
        "job_id": job["job_id"],
        "status": job["status"],
        "stage": job["stage"],
        "elapsed_seconds": round(float(job.get("elapsed_seconds") or 0.0), 1),
        "audio_seconds": job.get("audio_seconds"),
    }
    if job.get("error") is not None:
        payload["error"] = job["error"]
    if job["stage"] == "ready" and job.get("session") is not None:
        payload["session"] = job["session"]
    return payload


def _run_job(
    job: dict[str, Any],
    transcriber: Callable[
        [Callable[[str], None], Callable[[], bool]], tuple[list[dict[str, Any]], float | None]
    ],
    finish: Callable[[list[dict[str, Any]], float | None], dict[str, Any]],
) -> None:
    acquired = False
    try:
        _concurrency.acquire()
        acquired = True
        if job["cancelled"]:
            return
        job["started_at"] = time.monotonic()

        def set_stage(stage: str) -> None:
            if not job["cancelled"]:
                job["stage"] = stage

        cues, duration = transcriber(set_stage, lambda: bool(job["cancelled"]))
        if job["cancelled"]:
            return
        job["audio_seconds"] = duration or job.get("audio_seconds")
        session = finish(cues, duration)
        if job["cancelled"]:
            return
        job["session"] = session
        job["stage"] = "ready"
        job["status"] = "ready"
    except Exception as exc:
        if job["cancelled"]:
            return
        code = getattr(exc, "code", None)
        message = getattr(exc, "message", None)
        # A policy refusal arrives as HTTPException from the shared gate; keep
        # its code so the UI never shows the ".srt upload" hint for a gate hit.
        detail = getattr(exc, "detail", None)
        if isinstance(detail, dict):
            code = detail.get("code", code)
            message = detail.get("message", message)
        if not isinstance(code, str):
            code = "asr_failed"
            logger.warning("ASR job failed: %s", type(exc).__name__)
        job["error"] = {
            "code": code,
            "message": message if isinstance(message, str) else "Nghe audio không thành công.",
        }
        job["stage"] = "failed"
        job["status"] = "failed"
    finally:
        job["elapsed_seconds"] = (
            time.monotonic() - float(job["started_at"])
            if job.get("started_at") is not None
            else 0.0
        )
        if job.get("finished_at") is None:
            job["finished_at"] = time.monotonic()
        if acquired:
            _concurrency.release()
