# YouTube Mind Map Generator

[![CI](https://github.com/KivicDu/yt-mindmap/actions/workflows/ci.yml/badge.svg)](https://github.com/KivicDu/yt-mindmap/actions/workflows/ci.yml)

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
- Google Gemini API (`google-genai` SDK)
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
- [x] Node tree with stable ids as the source of truth (Markdown is generated)
- [x] Click a topic to seek the video to its timestamp
- [x] Retry with exponential backoff and request timeout for AI calls
- [x] Rolling context (truncated map + compact summary) to control token cost
- [x] Health endpoint, configurable CORS, Docker images and CI

## Getting Started

### Option A — Docker (one command)

```bash
export GEMINI_API_KEY=your_gemini_key_here
docker compose up --build
```

Open http://localhost:8080. The API runs on http://localhost:8001 (docs at
`/docs`), and the mind map cache is kept in the `mindmap-data` volume.

> `VITE_API_BASE` is baked into the frontend at build time. When deploying,
> rebuild with `--build-arg VITE_API_BASE=https://your-api-host` and set
> `ALLOWED_ORIGINS` to the frontend origin.

### Option B — Local development

#### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # then set GEMINI_API_KEY
uvicorn main:app --port 8001 --host 127.0.0.1
```

API docs: http://127.0.0.1:8001/docs · Health: http://127.0.0.1:8001/healthz

#### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env              # optional: set VITE_API_BASE
npm run dev -- --port 5173 --host 127.0.0.1
```

Open http://127.0.0.1:5173, paste a YouTube lecture URL, then press **Load Video** and play.

If the video has no captions, enter its URL and use **Upload .srt / .vtt** with a subtitle file.

## Testing and CI

```bash
# Backend
cd backend
pip install -r requirements-dev.txt
ruff check .
pytest

# Frontend
cd frontend
npm run lint
npm test
npm run build
```

`.github/workflows/ci.yml` runs the same commands on every push and pull
request to `main` and `develop`, plus a Docker job that builds both images,
smoke-tests the backend `/healthz` endpoint and checks the nginx-served bundle.

## Project Structure

```
yt-mindmap/
├── backend/
│   ├── main.py            # FastAPI app: transcript, SSE, update-map, health
│   ├── ai_engine.py       # Gemini calls, retries, payload normalisation
│   ├── node_tree.py       # Node ids, merge/dedupe, Markdown projection
│   ├── chunking.py        # Pure chunk/seek rules (unit-tested)
│   ├── subtitles.py       # .srt / .vtt parser (unit-tested)
│   ├── transcript.py      # YouTube captions fetcher
│   └── tests/             # pytest suite
├── frontend/
│   └── src/
│       ├── App.tsx        # player + update loop + session recovery
│       ├── components/    # markmap wrapper (lazy-loaded)
│       └── lib/           # pure tree helpers + vitest tests
├── docs/
│   ├── architecture.md    # flows, invariants, data model
│   └── adr/               # architecture decision records
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Documentation

- [Architecture](docs/architecture.md) — component and sequence diagrams, invariants
- [ADR 0001](docs/adr/0001-incremental-budgeted-ai.md) — incremental, budgeted AI calls
- [ADR 0002](docs/adr/0002-sessions-sse-disk-cache.md) — sessions, SSE, disk cache
- [ADR 0003](docs/adr/0003-markdown-to-node-tree.md) — node tree as the source of truth
- [ADR 0004](docs/adr/0004-collaboration-scope.md) — collaboration scope
- [Contributing workflow](CONTRIBUTING.md) — branch model and commit conventions

## How It Works

1. The frontend loads the transcript and opens an SSE connection to the backend.
2. While the video plays, the frontend asks the backend every ~15 seconds to process newly watched content.
3. The backend sends only the new transcript slice to Gemini, which returns new mind map nodes as JSON.
4. Each node gets a stable id; new branches are merged into the tree, folding repeated labels into the node that already exists.
5. The whole tree is pushed to the browser over SSE, which renders it with `markmap-view` (node ids are kept on every label, and Markdown is only a generated projection).

## Known Limitations

- Sessions are stored in memory (with TTL cleanup); the mind map cache is persisted to `backend/data/video_cache.json`.
- One backend worker only (in-memory session store); use Redis/DB to scale horizontally.
- Editing/deleting/pinning individual nodes is not implemented yet, but nodes now carry stable ids, so these are additive features (see ADR 0003).
- Collaboration, accounts and a database are planned but not built yet (see ADR 0004).
- Captions are fetched in English; Vietnamese and other languages are on the roadmap.
- AI usage costs and rate limits apply.
