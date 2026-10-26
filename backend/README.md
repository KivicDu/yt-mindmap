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
| POST | `/transcript` | Fetch captions from a URL, or parse an uploaded `.srt`/`.vtt` |
| GET | `/stream/{session_id}` | SSE stream of mind map updates |
| POST | `/update-map` | Process newly watched content and return a diff |

## Notes

- Sessions are kept in memory (`sessions` dict) and are lost on restart.
- `.env` is loaded before `ai_engine` is imported so the API key is available at startup.
