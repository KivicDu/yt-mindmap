# YouTube Mind Map Generator

An AI-powered real-time mind map generator that builds a mind map in parallel as a YouTube lecture video plays.

## Project Overview

This project creates a dual-view setup: alongside the YouTube video, there's a dedicated space for building a mind map in real-time. As the lecture progresses, the mind map updates accordingly to help learners focus and better retain information.

## Tech Stack

### Frontend
- React 19 + TypeScript + Vite
- YouTube IFrame API / react-youtube
- markmap (for mind map visualization)

### Backend
- FastAPI (Python)
- youtube-transcript-api
- Google Gemini API
- Server-Sent Events (SSE) for real-time updates

## Features

- [x] YouTube URL input
- [x] Video playback with dual-view layout
- [x] Real-time transcript extraction
- [x] Incremental AI-powered mind map generation (every ~15 seconds)
- [x] SSE for pushing updates to the frontend
- [x] Minimal diff merging into the mind map
- [x] Basic controls (pause auto-updates, manual update)
- [x] Subtitle upload fallback for videos without captions (`.srt` / `.vtt`)
- [x] Seek handling (backward seek is ignored, forward jumps are capped per update)
- [x] Session recovery if the backend restarts mid-lecture
- [x] Mind map cache per video (reopening a video restores the map instantly)
- [x] Disk persistence for the mind map cache (survives backend restarts)
- [x] Session TTL + limits (stale sessions are cleaned up automatically)
- [x] Highlight new nodes and auto-pan to them
- [x] Focus recent mode (collapse older branches)
- [x] Click a topic to seek the video to its timestamp
- [x] Retry with exponential backoff and request timeout for AI calls
- [x] Rolling context (truncated map + compact summary) to control token cost

## Getting Started

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # then set GEMINI_API_KEY
uvicorn main:app --port 8001 --host 127.0.0.1
```

API docs: http://127.0.0.1:8001/docs

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env              # optional: set VITE_API_BASE
npm run dev -- --port 5173 --host 127.0.0.1
```

Open http://127.0.0.1:5173, paste a YouTube lecture URL, then press **Load Video** and play.

If the video has no captions, enter its URL and use **Upload .srt / .vtt** with a subtitle file.

## How It Works

1. The frontend loads the transcript and opens an SSE connection to the backend.
2. While the video plays, the frontend asks the backend every ~15 seconds to process newly watched content.
3. The backend sends only the new transcript slice to Gemini, which returns new mind map nodes as JSON.
4. Nodes are converted to Markdown, appended to the accumulated map, and pushed to the browser over SSE.
5. markmap transforms the Markdown into a tree and renders it as the mind map.

## Known Limitations

- Sessions are stored in memory (with TTL cleanup); the mind map cache is persisted to `backend/data/video_cache.json`.
- One backend worker only (in-memory session store); use Redis/DB to scale horizontally.
- Editing/deleting/pinning individual nodes is not implemented yet.
- AI usage costs and rate limits apply.
- Large markmap bundle (~900 kB); consider code-splitting for production.
