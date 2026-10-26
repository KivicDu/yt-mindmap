# ADR 0001 — Incremental, budgeted AI calls

## Status
Accepted

## Context
Lecture videos are long (30–180 minutes) but a full transcript (20–60k
characters) is too large and too expensive to send to Gemini on every update.
The map must also appear early, not after the video ends.

## Decision
Process the transcript in **incremental chunks** driven by playback position:

- Select only entries newer than `consumed_until`, up to the playhead + 2s.
- Cap a chunk at 180 seconds or 300 entries.
- Send the model the new chunk, a rolling summary (≤1.2k chars) and the tail of
  the current map (≤4k chars), not the whole history.
- Advance `consumed_until` only after a successful call; on failure the same
  chunk is retried on the next tick.

## Consequences
- Cost per update is bounded and predictable.
- The map may lag the video by up to one update interval (~15s).
- Early mistakes persist in the map because old chunks are not re-read; the
  planned consolidation pass and "regenerate section" action address this.
- A very large forward seek produces several chunks over several ticks instead
  of one expensive request.
