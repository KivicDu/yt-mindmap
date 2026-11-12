# ADR 0013 — The map type decides what the AI extracts

## Status

Proposed

## Context

The four layouts shipped so far are **drawings of one tree**. The AI always
extracts the same thing — a hierarchy of concepts — and `spider`, `bubble` and
`circle` only place those nodes differently. A learner who picks "Bubble map"
still gets categories, not attributes; "Circle map" still gets a hierarchy, not
context.

That is a real gap. The names are not decoration: they come from the Thinking
Maps set used in classrooms, and each one stands for a different thinking
operation:

| Map | Thinking operation | What the centre asks |
|---|---|---|
| Tree | classifying | "What kinds of this are there?" |
| Spider | supporting | "Which main points hold this up?" |
| Bubble | describing | "What is it like?" |
| Circle | defining in context | "What do I know around this?" |

Drawing an attribute map as a tree is legitimate (an attribute list is flat
data); generating categories and *calling* it a bubble map is not.

Two constraints shape the decision:

1. **Content arrives incrementally** (ADR 0001): every ~15 s a chunk of
   transcript is mapped onto the existing tree, with the model seeing a rolling
   summary and the tail of the map, not the whole history.
2. **The tree is the stored format** (ADR 0003): `nodes`, `markdown`, the
   editor, autosave, sharing, export and the disk cache all assume
   `{name, time, children, note}`.

## Decision

### 1. The layout is also the content mode

`tree`, `spider`, `bubble`, `circle` each imply one thinking mode. `tree-down`
is a *rendering* of the tree mode — the same content, drawn top-down — so it
maps to `tree` and never triggers a rebuild.

No new database column: `projects.map_layout` already records the choice, and a
project's content was generated for the mode it was created with. A separate
`content_mode` column would only be needed to *view* bubble content as a tree,
which nothing asks for today; the ADR notes it as the escape hatch if that
changes.

### 2. What each mode asks the model for

The prompt gains a mode block after the shared preamble. The blocks are the
contract — they are what makes the four maps different:

**tree — classification**

- Level 1 are categories of the topic, level 2 are members, level 3 only
  explains a member.
- Labels are noun phrases, 2–6 words, no sentences.
- Examples go under the category they exemplify, never beside it.

**spider — supporting ideas**

- Level 1 are the main points that hold the topic up, each understandable on
  its own.
- Keep it flat: at most one child per point, and only for a concrete detail.
- Labels are short claims ("Mang lọc oxy từ nước"), not category names
  ("Cơ quan hô hấp").
- Never group points into sub-categories.

**bubble — attributes**

- Level 1 describe what the topic is *like*: a property, a part, a function, a
  behaviour.
- Labels finish the sentence "<topic> …" — "có màng nhầy", "dẫn truyền xung
  điện".
- Children of an attribute are the evidence or example from the lecture, at
  most one level deep.
- No chronology, no categories, no unrelated facts.

**circle — context**

- Level 1 are frames of context, one line each: definition, example, use, link
  to prior knowledge, formula, sign.
- Use a frame only when the lecture actually covers it; never invent a
  definition the speaker did not give.
- Flat: no nesting under a frame.
- Label the frame first: "Định nghĩa: …", "Ví dụ: …".

Everything else (ignore filler, dedupe against the existing map, attach `time`,
keep the summary under 800 characters, return the same JSON object) is
unchanged.

### 3. The node schema does not change

`{name, time, children, note}` stays. What changes is the **meaning of each
level**, which lives in the prompt, not in the JSON.

The alternative — a `kind` field (`category` / `support` / `attribute` /
`context`) — would let the renderer style roles and let us validate a bubble map
for stray categories. It is deferred because every consumer would have to carry
it: `merge_nodes`, the markdown cache (`markdown_to_tree` would silently drop
it), autosave, export, and the editor. Encoding roles in markdown comments
(`<!-- kind: attribute -->`) is possible but is its own change, and the gain is
cosmetic until the renderer actually draws roles differently.

Depth caps are therefore **prompt-level**, not enforced by truncation. Losing a
real point is worse than an extra ring, and the radial renderer already handles
depth. If the model ignores a cap, the map is still readable; if we truncate,
information silently disappears.

### 4. The mode travels with the session

- `POST /transcript` accepts `map_layout` (default `tree`). Reopening a project
  passes `project.map_layout`; a new URL/file session passes what the picker
  chose.
- The session stores it as `map_mode` (already normalised: `tree-down` →
  `tree`) and hands it to `generate_incremental_update`.
- `POST /session/{id}/restructure { map_layout }` rewrites the existing tree
  into the new mode and replaces the session's nodes, markdown and mode.
- A renderer-only change (`tree` ↔ `tree-down`) sends nothing and costs nothing.

### 5. Switching mode rewrites, it does not re-extract

Rebuilding a map from the transcript would need every chunk again (many calls,
minutes of latency) and would throw away the learner's edits and notes.

Instead, one call takes the existing markdown and asks the model to **rewrite
the map in the new mode**, with three rules: use only content already in the
map, keep every `time`, drop what does not fit the mode.

Trade-off, stated plainly: a rewrite can only reorganise what is already there,
so it cannot recover detail that the old mode discarded. The tree mode keeps
the most, so `tree → bubble → tree` is lossy in the second step. To make that
recoverable, the session keeps an **in-memory map per mode** (`session["maps"]`)
for the modes it has held; switching back to a mode visited earlier restores it
without a call. Persisted projects keep only the current mode.

If the existing map is larger than `MAX_RESTRUCTURE_CHARS` (12 000 chars, ≈ 240
nodes) the endpoint refuses with `map_too_large` and a Vietnamese message
instead of truncating the input; chunked rewriting is a follow-up.

On AI failure the session keeps its old nodes and mode, and the endpoint returns
`ai_error`; the UI says the content was not rebuilt.

### 6. Cache and provenance

The disk cache is keyed by `video_id`, so it can now hold content generated for
a different mode. Cache entries gain `"map_mode"`; a session only reuses an
entry whose mode matches. Entries written before this change have no field and
are treated as `tree`, which is what they are.

A mismatch is not an error: the session starts empty and the map is built again
from the playhead. The cache stays best-effort and single-entry per video.

### 7. UI

- The picker still has one choice. For a **new** map, that choice is both the
  look and the thinking mode, so the first chunk is already right.
- Changing the layout of a map that already has content does **not** silently
  spend tokens or destroy structure. The renderer changes immediately and a
  dismissible bar appears:
  > Đã đổi cách vẽ. Nội dung vẫn được tạo theo kiểu **Tree map**.
  > [Tạo lại theo kiểu **Bubble map**]
- While rewriting: "Đang tạo lại nội dung…". On failure: a toast, and the map
  is untouched.
- `tree` ↔ `tree-down` never shows the bar.

## Consequences

- Four maps finally differ in content, not only in geometry.
- Per-update cost is unchanged: the mode block is ~150 tokens.
- A mode switch costs one call and a few seconds.
- The session holds up to four trees in memory (bounded by node count, cleared
  with the session).
- Existing saved projects keep the content they have. They are not rebuilt on
  open; the bar offers it. That is deliberate: silently rewriting a learner's
  map is worse than an out-of-date mode.
- Restructuring is lossy for modes that keep less (bubble, circle). The mode
  memory is the undo, and it does not survive a reload.
- The prompt contract is now four texts that can drift. The unit tests assert
  the mode block reaches the request, not that the model obeys it; real quality
  can only be judged by generating maps for the same lecture in all four modes.

## Alternatives considered

**A different JSON schema per mode** (e.g. bubble returns
`{attributes: [{label, evidence}]}`). Rejected: it multiplies parsing,
merging, caching and export code, and the editor would need four shapes. The
tree shape can express all four; only the meaning of a level differs.

**Re-extract from the transcript on switch.** Rejected for cost and latency,
and it discards edits. Kept as a possible explicit "làm lại từ đầu" action
later, which is a different promise from "đổi kiểu".

**A `content_mode` column separate from `map_layout`.** Rejected for now: the
only use is viewing one mode's content through another renderer, and nothing
asks for it. It stays the escape hatch if we later want "bubble content, tree
drawing".

**Let the model choose the mode from the content.** Rejected: the learner
chose; a map that silently becomes something else is worse than a prompt that
occasionally over-nests.

## Implementation plan

1. **Engine** (`backend/ai_engine.py`): `CONTENT_MODES` with the four blocks,
   pure `build_incremental_prompt(mode, …)` and `build_restructure_prompt(mode,
   markdown)`, `mode` threaded through `generate_incremental_update`, new
   `restructure(markdown, mode)`. Unit tests capture the prompt sent to a stub
   client and assert the mode block, and that an unknown mode falls back to
   `tree`.
2. **Session and API** (`backend/main.py`): `TranscriptRequest.map_layout`,
   `session["map_mode"]`, pass it to the engine, `POST /session/{id}/restructure`
   with `map_too_large` / `ai_error` / `busy` codes, `session["maps"]` memory,
   cache `map_mode` check. Tests: mode reaches the AI call; restructure replaces
   nodes and mode; cache from another mode is ignored; a too-large map is
   refused.
3. **Frontend** (`mapStyle.ts`, `Workspace`): `contentMode(layout)` helper,
   send `map_layout` when creating a session, call `restructure` from the bar,
   keep the renderer change instant. Tests: `tree-down` → `tree`, the bar
   appears only for a real mode change.
4. **Verify** with a real lecture in all four modes, then compare the four maps
   of the same video side by side; the acceptance test is that the bubble map
   contains attributes and no categories, and the circle map contains context
   frames and no nesting.

Out of scope: role styling in the renderer, per-mode disk cache entries,
chunked restructure, an explicit "rebuild from transcript" action, and palette
work.
