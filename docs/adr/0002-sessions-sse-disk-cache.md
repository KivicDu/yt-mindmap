# ADR 0002 — Server-side sessions with SSE and a disk cache

## Status
Accepted

## Context
The map must survive re-renders, and updates must reach the browser without
polling. The app is a single-user tool today; accounts and a database are not
justified yet.

## Decision
- Keep session state **server-side in memory** (transcript, pointer, summary,
  Markdown, event buffer), keyed by `session_id`.
- Push diffs with **Server-Sent Events** (`GET /stream/{session_id}`), because
  updates are one-way after the initial POST.
- Persist the finished map **per video on disk** (`data/video_cache.json`,
  atomic writes, 50-video cap) so reopening a video restores instantly and a
  backend restart does not lose the map.
- Expose `/update-map` as the only mutating call; it returns the diff as well so
  a dropped SSE connection is not fatal.

## Consequences
- Zero infrastructure: no Redis, no DB, no WebSocket server.
- One uvicorn worker only; sessions die on restart (the cache keeps the map).
- SSE is one-way, so the planned collaboration feature will need WebSocket or a
  second channel for presence and comments (see ADR 0004).
