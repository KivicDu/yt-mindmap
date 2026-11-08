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
- PostgreSQL 18 + SQLAlchemy 2 + Alembic
- JWT access tokens, HttpOnly refresh cookie, bcrypt password hashing
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
- [x] Edit any node: rename it, attach a note, pin it (edits survive AI updates and reloads)
- [x] Pinned branches stay open in "focus recent" mode
- [x] Click a topic to seek the video to its timestamp
- [x] Retry with exponential backoff and request timeout for AI calls
- [x] Rolling context (truncated map + compact summary) to control token cost
- [x] Health endpoint, configurable CORS, Docker images and CI
- [x] Accounts: email + password sign-up, login, silent session restore and logout
- [x] Google & GitHub OAuth (code complete; needs client credentials, see [docs/auth-oauth.md](docs/auth-oauth.md))
- [x] Protected `/dashboard` with sidebar, account settings and sign-out
- [x] The workspace stays usable without an account — login is only needed to save projects
- [x] Saved projects: the whole map (nodes, notes, pins, transcript, AI pointer) is stored per account
- [x] Autosave while signed in, plus a `localStorage` draft for guests so a reload keeps the work
- [x] Dashboard CRUD: overview stats, recent projects, separate drafts, search, rename, duplicate, delete, promote
- [x] Reopen a project without calling YouTube again
- [x] Share a link with view-only or edit access; anonymous visitors can read, editing needs an account
- [x] Invite by email (including before registration) and see shared projects under “Được chia sẻ”
- [x] Realtime collaboration: editors share one live session, node edits and AI diffs arrive over SSE
- [x] Revoke by turning sharing off (old link dies) or rotate to a new link; only the owner can delete or change settings
- [x] Account self-service: change the display name and password (current password required)
- [x] Email verification links with single-use tokens (development outbox logs the link until SMTP is configured)
- [x] Refresh tokens are registered server-side, so logout and password changes revoke them

## Getting Started

### Option A — Docker (one command)

```bash
export GEMINI_API_KEY=your_gemini_key_here
export JWT_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
docker compose up --build
```

Open http://localhost:8080. The API runs on http://localhost:8001 (docs at
`/docs`), the mind map cache is kept in the `mindmap-data` volume, and accounts
in the `mindmap-db` Postgres volume. Migrations run automatically on start.

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
cp .env.example .env              # then set GEMINI_API_KEY, DATABASE_URL, JWT_SECRET_KEY
```

Accounts need PostgreSQL. With Homebrew:

```bash
brew install postgresql@18 && brew services start postgresql@18
psql -h 127.0.0.1 -d postgres -c "create role ytmindmap with login password 'ytmindmap';"
psql -h 127.0.0.1 -d postgres -c "create database ytmindmap owner ytmindmap;"
./venv/bin/alembic upgrade head
```

```bash
uvicorn main:app --port 8001 --host 127.0.0.1
```

API docs: http://127.0.0.1:8001/docs · Health: http://127.0.0.1:8001/healthz

Google/GitHub sign-in is optional and off until you add client credentials —
see [docs/auth-oauth.md](docs/auth-oauth.md).

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
│   ├── app/               # Accounts: settings, DB session, User model, auth + OAuth routes
│   ├── alembic/           # Migrations (alembic upgrade head)
│   └── tests/             # pytest suite
├── frontend/
│   └── src/
│       ├── pages/         # Home, Auth (login/register), Dashboard, Workspace
│       ├── context/       # Auth + MindmapConfig providers
│       ├── lib/           # API client + pure tree helpers (+ vitest)
│       └── components/    # markmap wrapper, route guard
├── docs/
│   ├── architecture.md    # flows, invariants, data model
│   ├── auth-oauth.md      # Google/GitHub console setup
│   └── adr/               # architecture decision records
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Documentation

- [Architecture](docs/architecture.md) — component and sequence diagrams, invariants
- [Auth & OAuth setup](docs/auth-oauth.md) — Google/GitHub client IDs, flow, troubleshooting
- [ADR 0001](docs/adr/0001-incremental-budgeted-ai.md) — incremental, budgeted AI calls
- [ADR 0002](docs/adr/0002-sessions-sse-disk-cache.md) — sessions, SSE, disk cache
- [ADR 0003](docs/adr/0003-markdown-to-node-tree.md) — node tree as the source of truth
- [ADR 0004](docs/adr/0004-collaboration-scope.md) — collaboration scope
- [ADR 0005](docs/adr/0005-accounts-jwt-oauth.md) — accounts, JWT and OAuth
- [ADR 0006](docs/adr/0006-saved-projects.md) — saved projects, autosave and per-user notes
- [ADR 0007](docs/adr/0007-sharing-and-collaboration.md) — sharing, invites and realtime collaboration
- [ADR 0008](docs/adr/0008-account-security.md) — profile, email verification and refresh-token revocation
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
- Deleting nodes is not implemented: the AI owns structure, so a wrong branch is fixed by renaming it or by improving the prompt.
- Projects, drafts and their notes/pins live in PostgreSQL per account. Guests still use the shared video cache, so a guest's notes on a video are visible to the next guest who opens it.
- Sharing has three modes: private, anyone with the link, or only invited emails. Anonymous visitors can only read; editing always needs a signed-in account.
- A share link has its own role (`viewer`/`editor`), and invited members can be given a stronger role than the link. Turning sharing off clears the slug, so old links never come back; rotating creates a new one.
- Realtime collaboration reuses one live session per project and the existing SSE stream. Conflicts are last-write-wins per edit; there is no presence cursor, CRDT or offline merge yet.
- Only the owner can rename the project, change sharing, invite people or delete it. Editors can change the map; viewers cannot write.
- Live sessions and SSE buffers are still per process, so realtime collaboration across multiple backend workers needs Redis pub/sub.
- A project stores a copy of its transcript, so the same lecture saved twice uses roughly twice the space. Deleting a project is permanent (no trash/undo).
- Project lists are paginated by the API (50 by default) but the dashboard does not render pagination controls yet.
- Email verification is implemented with single-use tokens, but delivery is development-only: the link is written to the backend log (and optionally returned when `DEBUG_EMAIL_LINKS=true`) instead of being emailed. Configure an SMTP transport before using it in production.
- There is no password-reset flow yet, and the email address itself cannot be changed from the dashboard.
- Refresh tokens are registered server-side, so logout and password changes revoke them. Access tokens remain stateless and stay valid until they expire (15 minutes), so a copied access token is not revoked immediately.
- Captions use the video's available original-language track. The server-side
  `youtube-transcript-api` client can still be rate-limited or blocked by
  YouTube; upload an `.srt` or `.vtt` file as a fallback.
- Playback and caption extraction are independent: some videos cannot be
  embedded because of owner settings, privacy, age, or region restrictions.
  Those videos must be opened on YouTube; the app cannot override those rules.
- The official [YouTube captions API](https://developers.google.com/youtube/data/reference/rest/v3/captions/list)
  requires OAuth, and
  [downloading a caption track](https://developers.google.com/youtube/data/reference/rest/v3/captions/download)
  requires permission to edit that video. It is not a general API for fetching
  captions from arbitrary public videos.
- AI usage costs and rate limits apply.
