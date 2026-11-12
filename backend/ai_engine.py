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
# A rewrite sends the whole map, not a tail. Past this size the caller is told
# to refuse instead of silently losing nodes to truncation.
MAX_RESTRUCTURE_CHARS = 12000
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0
REQUEST_TIMEOUT = 60
DEFAULT_MODEL = "gemini-2.5-flash"
# Long provider messages are useful once, not 800 times.
MAX_LOGGED_ERROR_CHARS = 300

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


def describe_error(error: BaseException) -> str:
    """`ClientError: 429 RESOURCE_EXHAUSTED ...` — enough to diagnose.

    Logging only the class name (the previous behaviour) hides the one detail
    that matters: *why* the call failed. Provider messages can be very long, so
    the text is collapsed to one line and capped.
    """
    detail = " ".join(str(error).split())[:MAX_LOGGED_ERROR_CHARS]
    name = type(error).__name__
    return f"{name}: {detail}" if detail else name



# The map type is a thinking operation, not a drawing (ADR 0013). Each block
# below is the contract for one mode: it says what the levels mean. The tree
# shape can express all four, so only the prompt changes.
TREE_MODE = """MODE: TREE MAP (classifying)
The centre is a topic and the map answers "what kinds of this are there?".
- Level 1 nodes are categories of the topic; level 2 nodes are members of a
  category; a level 3 node only explains a member.
- Labels are noun phrases (2-6 words), never sentences.
- Put an example under the category it exemplifies, never beside it."""

SPIDER_MODE = """MODE: SPIDER MAP (supporting ideas)
The centre is a topic and the map answers "which main points hold this up?".
- Level 1 nodes are the main points, each understandable on its own.
- Stay flat: at most one child under a point, and only for a concrete detail.
- Labels are short claims ("The lungs take oxygen from the water"), not
  category names ("Respiratory organs").
- Never group points into sub-categories."""

BUBBLE_MODE = """MODE: BUBBLE MAP (describing)
The centre is a topic and the map answers "what is it like?".
- Level 1 nodes describe a property, a part, a function or a behaviour of the
  topic, not a kind of it.
- A level 1 label must finish the sentence "<topic> ..." ("has a mucous
  membrane", "carries electrical impulses").
- Children of an attribute are the evidence or the example the lecture gave,
  at most one level deep.
- No chronology, no categories, no facts that do not describe the topic."""

CIRCLE_MODE = """MODE: CIRCLE MAP (defining in context)
The centre is a topic and the map answers "what do I know around this?".
- Level 1 nodes are frames of context, one line each: definition, example,
  use, link to earlier knowledge, formula, sign or symbol.
- Open the label with the frame, in the language of the lecture
  ("Definition: ...", "Định nghĩa: ...", "Example: ...").
- Only add a frame the lecture actually covers; never invent a definition the
  speaker did not give.
- Flat: no nesting under a frame."""

CONTENT_MODES = {
    "tree": TREE_MODE,
    "spider": SPIDER_MODE,
    "bubble": BUBBLE_MODE,
    "circle": CIRCLE_MODE,
}
DEFAULT_MODE = "tree"
# Layouts that are only a different drawing of an existing mode.
MODE_ALIASES = {"tree-down": "tree"}


def normalize_mode(value: Any) -> str:
    """Map a layout name to the content mode it asks for.

    Unknown values fall back to `tree`: a map built with the wrong contract is
    worse than a map built with the default one.
    """
    raw = str(value or "").strip().lower()
    raw = MODE_ALIASES.get(raw, raw)
    return raw if raw in CONTENT_MODES else DEFAULT_MODE


def build_incremental_prompt(
    mode: str,
    markdown_context: str,
    summary_so_far: str,
    chunk_text: str,
    time_range: tuple,
) -> str:
    return f"""You build a mind map incrementally from a lecture transcript.

{CONTENT_MODES[normalize_mode(mode)]}

EXISTING MIND MAP (markdown already shown to the user):
{markdown_context}

SUMMARY OF EARLIER CONTENT:
{summary_so_far or "(none)"}

NEW TRANSCRIPT SEGMENT ({time_range[0]:.1f}s to {time_range[1]:.1f}s):
{chunk_text}

TASK:
Extract ONLY genuinely new, substantive content from the NEW segment, shaped
by the mode above.
- Do NOT repeat anything already in the existing mind map or covered by the summary.
- Ignore filler, greetings, jokes, music, transitions ("so", "okay", "let's move on").
- Keep titles short (2-6 words).
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


def build_restructure_prompt(mode: str, markdown: str) -> str:
    return f"""You rewrite an existing mind map so that it follows a different mode.

{CONTENT_MODES[normalize_mode(mode)]}

EXISTING MAP (markdown, timestamps in the links):
{markdown}

TASK:
Rewrite the map above for the mode described. Hard rules:
- Use ONLY content already present in the existing map. Do not add concepts,
  examples or definitions that are not there.
- Keep every "time" value on the node it belongs to. Never invent a time.
- Drop a node when it does not fit the mode.
- Keep the root topic as the first node.

Return ONLY this JSON object (no markdown fences, no extra text):
{{
  "nodes": [
    {{"name": "Topic", "time": 0.0, "children": [{{"name": "Point", "time": 12.0}}]}}
  ]
}}"""


def _load_json_object(text: str) -> dict[str, Any]:
    """Unwrap a JSON object from a model reply.

    Models sometimes wrap JSON in markdown fences or add prose around it.
    Raises on invalid JSON; callers keep the previous state and retry later.
    """
    cleaned = (text or "").strip()
    cleaned = cleaned.replace("```json", "").replace("```JSON", "").replace("```", "")
    if "{" in cleaned and "}" in cleaned:
        cleaned = cleaned[cleaned.find("{") : cleaned.rfind("}") + 1]
    data = json.loads(cleaned)
    return data if isinstance(data, dict) else {}


def parse_restructure_payload(text: str) -> list[dict[str, Any]]:
    """Read the rewritten tree from a restructure reply."""
    nodes = _load_json_object(text).get("nodes")
    return nodes if isinstance(nodes, list) else []


def parse_ai_payload(
    text: str,
    summary_so_far: str,
    default_time: float,
) -> dict[str, Any]:
    """Turn a raw Gemini reply into a normalised incremental-update result."""
    data = _load_json_object(text)
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
        # Optional override so the AI path can be pointed at a mock or a proxy
        # (tests, offline demos, a gateway in front of the real API).
        self.base_url = os.getenv("GEMINI_BASE_URL", "").strip()
        self.client = None
        # Running token totals for this process, surfaced by /healthz.
        self.usage_totals = {"prompt": 0, "output": 0, "total": 0, "calls": 0}
        if self.api_key and genai is not None:
            try:
                # The new SDK takes the timeout once, in milliseconds.
                options: dict[str, Any] = {"timeout": REQUEST_TIMEOUT * 1000}
                if self.base_url:
                    options["base_url"] = self.base_url
                self.client = genai.Client(
                    api_key=self.api_key, http_options=genai_types.HttpOptions(**options)
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Gemini client could not be created: %s", describe_error(exc))
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
                    "Gemini call failed (attempt %d/%d, retrying in %.0fs): %s",
                    attempt + 1,
                    MAX_RETRIES,
                    delay,
                    describe_error(exc),
                )
                time.sleep(delay)
        raise RuntimeError("unreachable")  # pragma: no cover

    def generate_incremental_update(
        self,
        current_markdown: str,
        transcript_chunk: list[dict[str, Any]],
        summary_so_far: str = "",
        time_range: tuple = (0, 0),
        mode: str = DEFAULT_MODE,
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

        prompt = build_incremental_prompt(
            mode=mode,
            markdown_context=markdown_context,
            summary_so_far=summary_so_far,
            chunk_text=chunk_text,
            time_range=time_range,
        )

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
            # The UI only sees "AI busy"; the actual cause belongs in the log.
            logger.warning("Mind map update failed: %s", describe_error(e))
            return {
                "markdown_diff": "",
                "new_nodes": [],
                "should_update": False,
                "summary": summary_so_far,
                "error": str(e),
            }

    def restructure(self, markdown: str, mode: str) -> dict[str, Any]:
        """Rewrite an existing map into another content mode.

        This reorganises what the map already holds; it never re-reads the
        transcript, so it cannot recover detail an earlier mode discarded.
        """
        mode = normalize_mode(mode)
        text = (markdown or "").strip()
        if not text:
            return {"nodes": [], "mode": mode}

        if not self.client:
            return {"nodes": [], "mode": mode, "note": "AI not configured"}

        try:
            response = self._generate_with_retry(build_restructure_prompt(mode, text))
            self._record_usage(response)
            return {"nodes": parse_restructure_payload(response.text or ""), "mode": mode}
        except Exception as e:
            logger.warning("Mind map restructure failed: %s", describe_error(e))
            return {"nodes": [], "mode": mode, "error": str(e)}


ai_engine = MindMapAI()
