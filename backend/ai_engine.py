import json
import logging
import os
import time
from typing import Any

try:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types as genai_types
except Exception:  # pragma: no cover - the SDK is optional at runtime
    genai = None
    genai_errors = None
    genai_types = None

logger = logging.getLogger(__name__)

MAX_MARKDOWN_CHARS = 4000
MAX_CHUNK_CHARS = 8000
MAX_SUMMARY_CHARS = 1200
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0
REQUEST_TIMEOUT = 60
DEFAULT_MODEL = "gemini-2.5-flash"

# Server-side statuses that will fail again no matter how often we retry.
NON_RETRYABLE_STATUSES = frozenset(
    {
        "INVALID_ARGUMENT",
        "UNAUTHENTICATED",
        "PERMISSION_DENIED",
        "NOT_FOUND",
        "FAILED_PRECONDITION",
    }
)
NON_RETRYABLE_CODES = frozenset({400, 401, 403, 404})

# Fallback for errors that are not genai APIErrors (older SDKs, wrappers).
AUTH_MARKERS = (
    "api key",
    "api_key",
    "permission",
    "unauthenticated",
    "invalid_argument",
    "401",
    "403",
)


def is_retryable(error: BaseException) -> bool:
    """Return True when calling Gemini again has a realistic chance of working.

    Bad credentials, missing permissions and malformed requests are permanent
    failures; retrying them only burns quota. Rate limits, 5xx responses and
    network timeouts are transient and worth retrying.
    """
    if genai_errors is not None and isinstance(error, genai_errors.APIError):
        if error.status in NON_RETRYABLE_STATUSES:
            return False
        return error.code not in NON_RETRYABLE_CODES

    message = str(error).lower()
    return not any(marker in message for marker in AUTH_MARKERS)


def parse_ai_payload(
    text: str,
    summary_so_far: str,
    default_time: float,
) -> dict[str, Any]:
    """Turn a raw Gemini reply into a normalised incremental-update result.

    Models sometimes wrap JSON in markdown fences or add prose around it, so
    the payload is unwrapped before parsing. Raises on invalid JSON; callers
    keep the previous summary and retry the same chunk later.
    """
    cleaned = (text or "").strip()
    cleaned = cleaned.replace("```json", "").replace("```JSON", "").replace("```", "")
    if "{" in cleaned and "}" in cleaned:
        cleaned = cleaned[cleaned.find("{") : cleaned.rfind("}") + 1]

    data = json.loads(cleaned)
    nodes = data.get("new_nodes") or []
    if not isinstance(nodes, list):
        nodes = []
    markdown_diff = nodes_to_markdown(nodes, default_time=default_time)
    summary = str(data.get("summary") or summary_so_far).strip()
    return {
        "markdown_diff": markdown_diff,
        "new_nodes": nodes,
        "should_update": bool(data.get("should_update")) and bool(markdown_diff),
        "summary": summary[:MAX_SUMMARY_CHARS],
    }


def nodes_to_markdown(
    nodes: list[dict[str, Any]],
    depth: int = 0,
    default_time: float | None = None,
) -> str:
    """Convert nested node dicts to markdown bullet lines for markmap.

    If a node has a timestamp (or a default is provided), the label becomes a
    clickable link (`#seek-<seconds>`) that the frontend intercepts to seek.
    """
    lines = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        name = str(node.get("name") or node.get("title") or "").strip()
        if not name:
            continue
        indent = "  " * depth

        node_time = node.get("time")
        if not isinstance(node_time, (int, float)):
            node_time = default_time
        if isinstance(node_time, (int, float)) and node_time >= 0:
            safe_name = name.replace("[", "(").replace("]", ")")
            label = f"[{safe_name}](#seek-{float(node_time):.1f})"
        else:
            label = name

        lines.append(f"{indent}- {label}")
        children = node.get("children") or []
        if children:
            lines.append(nodes_to_markdown(children, depth + 1, default_time))
    return "\n".join([line for line in lines if line])


def _thinking_budget() -> int:
    """Thinking tokens for Gemini 2.5 models; 0 keeps updates fast and cheap.

    Extracting concepts from a transcript chunk is not a reasoning-heavy task,
    and this runs every ~15 seconds while a video plays, so latency matters.
    """
    raw = os.getenv("GEMINI_THINKING_BUDGET", "0").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


class MindMapAI:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.model_name = os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        self.client = None
        # Running token totals for this process, surfaced by /healthz.
        self.usage_totals = {"prompt": 0, "output": 0, "total": 0, "calls": 0}
        if self.api_key and genai is not None:
            try:
                # The new SDK takes the timeout once, in milliseconds.
                http_options = genai_types.HttpOptions(timeout=REQUEST_TIMEOUT * 1000)
                self.client = genai.Client(api_key=self.api_key, http_options=http_options)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Gemini client could not be created: %s", exc)
                self.client = None

    @property
    def configured(self) -> bool:
        return self.client is not None

    def _record_usage(self, response) -> None:
        """Accumulate token usage so callers can watch cost per session."""
        usage = getattr(response, "usage_metadata", None)
        if usage is None:
            return
        prompt_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        output_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
        total_tokens = int(getattr(usage, "total_token_count", 0) or 0)
        self.usage_totals["prompt"] += prompt_tokens
        self.usage_totals["output"] += output_tokens
        self.usage_totals["total"] += total_tokens or prompt_tokens + output_tokens
        self.usage_totals["calls"] += 1

    def _config(self):
        options: dict[str, Any] = {
            "response_mime_type": "application/json",
            "temperature": 0.4,
        }
        if genai_types is not None and hasattr(genai_types, "ThinkingConfig"):
            options["thinking_config"] = genai_types.ThinkingConfig(
                thinking_budget=_thinking_budget()
            )
        return genai_types.GenerateContentConfig(**options)

    def _generate_with_retry(self, prompt: str):
        """Call Gemini with exponential backoff for transient failures."""
        for attempt in range(MAX_RETRIES):
            try:
                return self.client.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config=self._config(),
                )
            except Exception as exc:
                if not is_retryable(exc) or attempt == MAX_RETRIES - 1:
                    raise
                delay = RETRY_BASE_DELAY * (2**attempt)
                logger.warning(
                    "Gemini call failed (%s), retrying in %.0fs", type(exc).__name__, delay
                )
                time.sleep(delay)
        raise RuntimeError("unreachable")  # pragma: no cover

    def generate_incremental_update(
        self,
        current_markdown: str,
        transcript_chunk: list[dict[str, Any]],
        summary_so_far: str = "",
        time_range: tuple = (0, 0),
    ) -> dict[str, Any]:
        if not transcript_chunk:
            return {
                "markdown_diff": "",
                "new_nodes": [],
                "should_update": False,
                "summary": summary_so_far,
            }

        chunk_text = "\n".join([f"[{e['start']:.1f}s] {e['text']}" for e in transcript_chunk])
        if len(chunk_text) > MAX_CHUNK_CHARS:
            chunk_text = chunk_text[:MAX_CHUNK_CHARS] + "\n...(segment truncated)"

        markdown_context = current_markdown or "(empty)"
        if len(markdown_context) > MAX_MARKDOWN_CHARS:
            markdown_context = (
                "...(earlier parts omitted; rely on the summary below)...\n"
                + markdown_context[-MAX_MARKDOWN_CHARS:]
            )

        prompt = f"""You build a mind map incrementally from a lecture transcript.

EXISTING MIND MAP (markdown already shown to the user):
{markdown_context}

SUMMARY OF EARLIER CONTENT:
{summary_so_far or "(none)"}

NEW TRANSCRIPT SEGMENT ({time_range[0]:.1f}s to {time_range[1]:.1f}s):
{chunk_text}

TASK:
Extract ONLY genuinely new, substantive concepts / definitions / relationships from the NEW segment.
- Do NOT repeat anything already in the existing mind map or covered by the summary.
- Ignore filler, greetings, jokes, music, transitions ("so", "okay", "let's move on").
- Keep titles short (2-6 words). Nest sub-points under a parent when they belong together.
- If the segment has no substantive content, set should_update to false.
- Keep "summary" under 800 characters; it is the compact memory for later segments.
- Add "time" (seconds from the start of the video) for when each concept is first mentioned.

Return ONLY this JSON object (no markdown fences, no extra text):
{{
  "should_update": true,
  "new_nodes": [
    {{"name": "Parent Topic", "time": 123.4, "children": [{{"name": "Sub Point", "time": 130.0}}]}}
  ],
  "summary": "compact summary of the whole map so far"
}}"""

        if not self.client:
            return {
                "markdown_diff": "",
                "new_nodes": [],
                "should_update": False,
                "summary": summary_so_far,
                "note": "AI not configured",
            }

        try:
            response = self._generate_with_retry(prompt)
            self._record_usage(response)
            return parse_ai_payload(
                response.text or "",
                summary_so_far=summary_so_far,
                default_time=float(time_range[0]),
            )
        except Exception as e:
            return {
                "markdown_diff": "",
                "new_nodes": [],
                "should_update": False,
                "summary": summary_so_far,
                "error": str(e),
            }


ai_engine = MindMapAI()
