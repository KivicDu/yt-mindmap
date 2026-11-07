# ADR 0007 — Sharing links, invited emails and realtime editors

## Status
Accepted

## Context
Phase 2 gave every account private projects. Phase 3 needs the Google Docs
model the product asked for:

- a link can be read by anyone without an account;
- a signed-in user may open the same link in a workspace and edit;
- the owner can restrict a link to invited emails;
- the owner decides whether the link grants view-only or edit;
- revoking means turning sharing off, and an old link must never come back;
- editors should see each other's changes while the project is open.

## Decision

**Owner stays `projects.user_id`.** Sharing does not copy the project and does
not introduce a second owner. The row keeps exactly one account responsible
for deleting it and for changing its settings.

**Three visibility states.**

| `visibility` | Who may open it | Link role applies |
| --- | --- | --- |
| `private` | owner only | no slug is kept |
| `unlisted` | anyone with the slug | yes (`link_role`) |
| `invited` | only `project_members` emails | no; each member has a role |

`projects.link_role` is `viewer` or `editor` and is what the link itself
grants. A member row always wins over the link role, so an invited editor can
edit an "anyone can view" project.

**Members are keyed by email.** `project_members` stores
`(project_id, email, role)`, with the email lower-cased. Inviting someone who
has not registered yet is therefore valid: the row starts working the moment
they sign in with that address. The owner is never a member row, and inviting
the owner's own email is rejected.

**The slug is a capability, not a secret reference.** It is
`YTMM-XXXXXXXX` (8 uppercase alphanumerics from `secrets`), unique in the
table, and only exists while sharing is on. Disabling sharing sets
`visibility=private` and clears the slug, so every old URL is dead.
Re-enabling generates a new slug; "Đổi link" rotates it without disabling.

**Access resolution** (`app/services/sharing.py`):

1. the owner gets `owner`;
2. a signed-in member gets their member role;
3. `unlisted` + slug yields `link_role`;
4. anything else is invisible (404, not 403).

Anonymous callers only ever read a public `unlisted` link. Editing requires a
signed-in user even when `link_role=editor`; the public share page then renders
read-only and offers "Mở để chỉnh sửa". An `invited` link asks anonymous
visitors to sign in (401) and tells a signed-in non-member that they were not
invited (403).

**One live session per project.** `find_project_session()` reuses the existing
in-memory session for a project instead of creating one per tab. The session's
existing SSE event log then becomes the realtime channel: a `node_edit` or AI
`diff` appended by one editor is delivered to every other tab watching the same
session. Conflicts are last-write-wins per edit; there is no CRDT, operational
transform or presence cursor yet.

**One AI call at a time.** Every editor polls `/update-map` while the video
plays. A per-session `threading.Lock` lets one request process the next
transcript chunk and returns `reason="busy"` to the others, so the same chunk is
never mapped twice.

**Roles on writes.**

- Owner: rename, duplicate, delete, share settings, invites, edit map, autosave.
- Editor: open, edit nodes/notes/pins, autosave map fields; cannot rename the
  project, change sharing, invite or delete.
- Viewer: read-only; `/node`, `/update-map` and autosave return 403
  `project_read_only`.

**Drafts are never shareable.** A share link always points at a saved project;
drafts stay private autosave rows.

**Public surface.** `GET /api/share/{slug}` returns the project, effective
role, `can_edit`, `requires_login`, owner name and the live session id if one
exists. The SPA route is `/s/:slug`; signed-in editors get a button to
`/app/:projectId`.

## Consequences
- The same link can be view-only for anonymous visitors and editable for
  invited editors, without duplicating the project.
- Old links cannot be revived by turning sharing back on; the owner gets a new
  capability every time.
- Realtime works through the existing SSE stream, so no WebSocket/CRDT layer was
  needed. The trade-off is coarse conflict handling: two edits to the same node
  resolve to whichever request lands last, and there is no cursor/presence UI.
- Invitations assume the provider's email is verified. Password accounts are
  usable immediately, so an unverified address could claim a pending invite (the
  same limitation as account creation, phase 4 adds verification).
- Live sessions remain per process. Multiple workers or instances need Redis
  pub/sub before collaboration works across them.
- Removing a member or disabling sharing takes effect on the next API request;
  an already-open workspace keeps its in-memory session until it closes.
