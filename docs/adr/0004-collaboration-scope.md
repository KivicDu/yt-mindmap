# ADR 0004 — Collaboration scope: watch together, comment, one host

## Status
Proposed

## Context
The product goal is a personal study tool that also works for a study group or
meeting: several people watch the same lecture and shape one shared mind map.
Full multi-user co-editing (CRDT) is expensive and interacts badly with the
AI-generated diffs if introduced too early.

## Decision
Ship collaboration in three steps:

1. **Shared room** — a room is bound to one video and one map; joining happens
   via an invite link.
2. **Presence + comments** — who is watching, who is editing a node, comments
   anchored to a node. No CRDT required: a small WebSocket hub plus Redis
   pub/sub is enough.
3. **Host-driven playback** — the host's playhead drives AI updates; others
   follow. Any participant can "take over" explicitly. This keeps AI cost equal
   to a single session and avoids divergent maps.

True concurrent node editing (Yjs/CRDT) is deferred until the node-tree
migration (ADR 0003) is complete and presence/comments validate the use case.

## Consequences
- Collab can be delivered incrementally with the existing session model.
- Playback control must be explicit in the UI; "follow the host" becomes a core
  interaction.
- The SSE channel remains for AI diffs; presence and comments use WebSocket.
