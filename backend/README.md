# Backend

FastAPI backend for real-time YouTube mind map generation.

## Setup

1. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Copy environment variables:
```bash
cp .env.example .env
# Add your GEMINI_API_KEY (and optionally GEMINI_MODEL)
# Add DATABASE_URL and JWT_SECRET_KEY for accounts (see below)
```

4. Create the PostgreSQL database (once):
```bash
brew services start postgresql@18
psql -h 127.0.0.1 -d postgres -c "create role ytmindmap with login password 'ytmindmap';"
psql -h 127.0.0.1 -d postgres -c "create database ytmindmap owner ytmindmap;"
./venv/bin/alembic upgrade head
```

5. Run server:
```bash
uvicorn main:app --reload --port 8001 --host 127.0.0.1
```

API docs: http://127.0.0.1:8001/docs

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Health check |
| GET | `/healthz` | Session count, cache size, model name, token totals (Docker healthcheck) |
| POST | `/transcript` | Fetch captions from a URL, or parse an uploaded `.srt`/`.vtt` |
| GET | `/stream/{session_id}` | SSE stream of mind map updates |
| POST | `/update-map` | Process newly watched content, merge new nodes into the tree, return the full tree |
| PATCH | `/node` | Rename, note or pin one node; returns the full tree and emits a `node_edit` SSE event |
| POST | `/api/auth/register` | Create an account (email, password, display name); sets the refresh cookie |
| POST | `/api/auth/login` | Email + password login; sets the refresh cookie |
| POST | `/api/auth/refresh` | Rotate the refresh cookie and return a short-lived access token |
| POST | `/api/auth/logout` | Clear both session cookies |
| GET | `/api/auth/me` | Current user (requires `Authorization: Bearer <access token>`) |
| GET | `/api/auth/providers` | Which OAuth providers have credentials configured |
| GET | `/api/auth/google` · `/api/auth/github` | Start OAuth: `302` to the provider (or back to `/login` with an error code) |
| GET | `/api/auth/{provider}/callback` | OAuth callback; sets the session cookies and redirects to `/dashboard` |

Password auth returns a short-lived access token in the body while the refresh
token lives in an HttpOnly cookie. OAuth uses the same cookies, so the SPA
restores the session the same way after a redirect. Google/GitHub setup is in
[docs/auth-oauth.md](../docs/auth-oauth.md).

## Tests

```bash
pip install -r requirements-dev.txt
ruff check .
pytest
```

`pytest.ini` adds the backend directory to the import path, so tests run from
this folder without installing the package.

## Layout

| File | Responsibility |
|------|----------------|
| `main.py` | App wiring, sessions, cache, endpoints |
| `ai_engine.py` | Gemini client (`google-genai`), retry policy, prompt, payload parsing, token accounting, error logging |
| `node_tree.py` | Node ids, normalisation, merge/dedupe, note/label edits, Markdown projection + legacy parse |
| `chunking.py` | Pure seek/chunk rules (no FastAPI import) |
| `subtitles.py` | `.srt` / `.vtt` parser |
| `transcript.py` | YouTube captions fetcher |
| `app/` | Accounts: settings, SQLAlchemy session, `User` model, auth/OAuth routes, services |
| `alembic/` | Database migrations (`alembic upgrade head`) |
| `tests/` | Unit + API tests |

## Notes

- Sessions are kept in memory (`sessions` dict) and are lost on restart; the
  per-video map cache is persisted to `data/video_cache.json`.
- A session stores the map as a node tree (`nodes`); `markdown` is generated from
  it with `node_tree.tree_to_markdown`. Caches written before the tree existed
  have no `nodes` and are re-parsed from Markdown on restore.
- User state (`note`, `pinned`, `aliases`) lives on the node, is written to the
  cache by `PATCH /node`, and is preserved when the AI merges new children in.
- `GEMINI_BASE_URL` can point the AI client at a mock or proxy, which is how
  tests exercise the AI path without calling Google.
- `.env` is loaded before `ai_engine` is imported so the API key is available at startup.
- Gemini calls use the `google-genai` SDK (the older `google-generativeai` package is
  end-of-life). `response_mime_type="application/json"` makes the model return JSON
  directly, and `GEMINI_THINKING_BUDGET` (default `0`) keeps updates fast and cheap.
- `ALLOWED_ORIGINS` accepts a comma-separated list and overrides the built-in
  localhost origins.
- Accounts live in PostgreSQL (`users` table, migration `0001_users`); the
  mind-map session/cache layer still lives in memory + `data/video_cache.json`.
- Tests run auth against an in-memory SQLite database injected through
  `app.dependency_overrides[get_db]`. SQLite is a test double only; the runtime
  database is always PostgreSQL.
- Passwords are hashed with `bcrypt` directly (not passlib, which depends on the
  `crypt` module removed in Python 3.13). Tokens are signed with PyJWT.
- OAuth routes redirect instead of returning JSON, including on failure, so the
  browser always ends up back on `/login` with a short `error` code.
- `Dockerfile` runs as a non-root user and exposes `/healthz` as a container
  healthcheck.
