# ADR 0003 — The mind map is a node tree, Markdown is a projection

## Status
Accepted — implemented

## Context
markmap natively renders Markdown, so the app stores the map as a Markdown
string and re-transforms it on every update. This kept the first version small,
but node identity is the label text, which means: no stable IDs, no per-node
notes or pins, no reliable undo, and no way for two users to edit the same map.

## Decision
Make the node tree the source of truth, in the backend, and generate Markdown
from it:

```text
node
├── id         str        # uuid, stable for the life of the node
├── parentId   str | None
├── label      str
├── time       float|None # video offset for click-to-seek
└── children   [node]
```

- `backend/node_tree.py` owns the format: `normalize_nodes` gives AI output ids
  and parent links, `merge_nodes` folds duplicates, `tree_to_markdown` renders
  the projection, `markdown_to_tree` reads maps cached by older versions.
- Sessions and the video cache store `nodes`; `markdown` is kept beside them
  only for compatibility.
- `/update-map` and the SSE event return the **whole tree**, so a client that
  missed an event still converges on the next one.
- The frontend renders the tree directly (`src/lib/mindmapTree.ts` builds
  markmap data with `data-node-id` on every label) and no longer parses
  Markdown, which removed `markmap-lib` and its transformer/katex/highlight.js
  payload.

Fields for editing (`note`, `pinned`, `createdBy`, `updatedAt`) are deliberately
left out until there is an endpoint that writes them; adding them later is
additive.

## Consequences
- Pin/note/rename, undo, comments and presence cursors now have an address
  (`node.id`) to attach to, without another rewrite.
- AI output merges as *additions*: a repeated label under the same parent keeps
  the existing id and time and absorbs the new children, so the map does not
  grow duplicates and a user's edits on that node survive later chunks.
- The map is ~75 kB of lazy JS instead of ~670 kB, because rendering no longer
  needs a Markdown pipeline.
- Costs: every update ships the full tree (fine at lecture scale, hundreds of
  nodes) and the client must tolerate a server that sends older shapes — hence
  `normalizeTree` on the client and `normalize_cached_nodes` on the server.
- Dedupe is by case-insensitive label *within the same parent*. Two genuinely
  distinct concepts with the same name under one parent collapse into one; a
  future node-level "keep both" affordance would need an explicit flag.
