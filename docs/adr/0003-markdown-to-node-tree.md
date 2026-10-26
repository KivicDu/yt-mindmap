# ADR 0003 — Markdown is the map today, a node tree is next

## Status
Accepted (revisit before collaboration)

## Context
markmap natively renders Markdown, so the app stores the map as a Markdown
string and re-transforms it on every update. This kept the first version small,
but node identity is the label text, which means: no stable IDs, no per-node
notes or pins, no reliable undo, and no way for two users to edit the same map.

## Decision
Keep Markdown as the source of truth for now, and isolate the logic that depends
on node identity into pure helpers (`src/lib/mindmapTree.ts`).

Before real-time collaboration, migrate to:

```ts
type MapNode = {
  id: string          // uuid, generated when AI or a user creates the node
  parentId: string | null
  label: string
  time?: number       // video offset for click-to-seek
  note?: string
  pinned?: boolean
  createdBy?: string
  updatedAt?: number
}
```

Markdown becomes a **projection** of the tree, generated at render time.

## Consequences
- Current features stay simple and cheap.
- Editing, undo, comments and CRDT-based co-editing are all blocked until the
  migration happens; doing it earlier avoids paying for a rewrite later.
- Stable IDs also make AI inserts merge-friendly: new nodes are additions, not
  text edits, so conflicts are rare.
