# ADR 0015 — The learner chooses the mind-map language

## Status

Proposed 2026-11-26.

## Context

A YouTube video can have several caption tracks, and the creator decides which
one is first. Today the workspace loads that first track and the AI has no
language argument at all: node labels follow whatever text happens to be in the
prompt. A learner studying an English lecture whose creator uploaded a Hindi
transcript therefore receives a Hindi mind map, even when they want to study in
Vietnamese.

The caption track and the study language are different things:

- the caption track is an **input** — text to read alongside the video;
- the study language is an **output** — the language of the map's labels and
  summary, of the self-check, and of the exported file.

ADR 0011 deliberately kept bilingual captions as a reading overlay and refused
to translate the map on that path. That decision stays. The missing piece is an
explicit learner choice for the map itself.

## Decision

### 1. Two fields, two meanings

`projects.transcript_language` remains the provenance of the cues. A new nullable
`projects.output_language` records the language the learner wants to study in.

`NULL` means "follow the caption track", so an old project keeps its current
behaviour until somebody chooses otherwise. A new workspace starts in
Vietnamese — the UI's language — from a browser preference, never from the
creator's caption order.

### 2. The choice travels with the artifact

The project row is the source of truth because the map, the self-check and the
share link are project-scoped. The live session carries the same value so every
AI path can read it: initial chunks, later updates, restructure, and relabel.
Switching or overlaying a caption track never writes `output_language`.

The prompt now states the target language explicitly and tells the model to use
it even when the transcript uses another one. Timestamps and proper nouns stay
as they are. The quiz already asks for the map's language, so it follows
automatically.

### 3. Changing language on an existing map is one bounded operation

New chunks in a new language mixed into old labels would produce a broken map.
When the learner changes the language after content exists, the server makes one
AI call that translates the existing labels **and** the running summary while
preserving node ids, notes, pins, order and timestamps. A malformed or failed
reply leaves the old map and the old choice intact.

Restoring "follow the caption track" is only offered for an empty map. On a
populated map it returns `rebuild_required` rather than silently mixing
languages; the learner can rebuild from the playhead if they want it.

### 4. Guest maps and caches

A guest draft carries the choice in `localStorage`, and the signed-in autosave
writes it to the project. The guest video cache stores the language alongside
the map; an entry built for another language is ignored instead of being mixed
into a new map.

## Consequences

- A learner can study an English lecture in Vietnamese even if only a Hindi
  caption track is available.
- Changing the caption track changes what is displayed, not what is generated.
- One language switch on a populated map spends one extra AI call; a switch on
  an empty map spends none.
- Export stays unchanged: it writes the labels the map already holds, now in
  the learner's language.

## Alternatives considered

- **Infer from the learner's browser locale with no UI.** Invisible and wrong
  for multilingual learners; the choice must be visible and reversible.
- **Store the preference only in `localStorage`.** A shared editor or a reopened
  project would disagree with its own map.
- **Translate only new chunks.** Produces a map split between two languages.
- **Rebuild the whole map on every switch.** Throws away notes and pins and
  spends far more tokens than relabelling.
