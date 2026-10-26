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
```

4. Run server:
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
| `ai_engine.py` | Gemini client (`google-genai`), retry policy, prompt, payload parsing, token accounting |
| `node_tree.py` | Node ids, normalisation, merge/dedupe, Markdown projection + legacy parse |
| `chunking.py` | Pure seek/chunk rules (no FastAPI import) |
| `subtitles.py` | `.srt` / `.vtt` parser |
| `transcript.py` | YouTube captions fetcher |
| `tests/` | Unit + API tests |

## Notes

- Sessions are kept in memory (`sessions` dict) and are lost on restart; the
  per-video map cache is persisted to `data/video_cache.json`.
- A session stores the map as a node tree (`nodes`); `markdown` is generated from
  it with `node_tree.tree_to_markdown`. Caches written before the tree existed
  have no `nodes` and are re-parsed from Markdown on restore.
- `.env` is loaded before `ai_engine` is imported so the API key is available at startup.
- Gemini calls use the `google-genai` SDK (the older `google-generativeai` package is
  end-of-life). `response_mime_type="application/json"` makes the model return JSON
  directly, and `GEMINI_THINKING_BUDGET` (default `0`) keeps updates fast and cheap.
- `ALLOWED_ORIGINS` accepts a comma-separated list and overrides the built-in
  localhost origins.
- `Dockerfile` runs as a non-root user and exposes `/healthz` as a container
  healthcheck.
