# ADR 0006 — Saved projects, autosave and per-user notes

## Status
Accepted

## Context
Phase 1 left the mind map in an in-memory session plus a disk cache keyed by
video id. That cache is shared by every visitor, which was fine while nobody
could sign in, but it makes two accounts watching the same lecture see each
other's node notes and pins. It also means a reload only restores the map while
the cache entry lives, and the dashboard has nothing real to show.

Phase 2 needs persistence that is private per account, survives a backend
restart, and can be reopened without paying for the captions again.

## Decision

**One project = one video (or one uploaded subtitle file) + one mind map.**
Courses and multi-video containers are deferred; a 1:1 mapping matches the
existing session model and keeps the migration small.

**The project row stores the whole map:** `nodes`, `transcript`,
`transcript_language`, `summary_so_far` and `consumed_until`. Reopening a
project therefore needs no YouTube call: `POST /transcript` with a
`project_id` rebuilds the session from the row with `use_cache=False`.

**Drafts and saved projects share one table.** Autosave writes `is_draft=true`
and reuses the newest draft for the same video, so opening a lecture twice in a
day does not litter the drafts list. The explicit "Lưu dự án" action promotes
the row with `PATCH {is_draft: false, title}`. A later autosave never demotes a
saved project back to a draft and never overwrites its title.

**Autosave copies the live session on the server.** The browser posts
`{session_id, project_id?}` to `POST /api/projects/autosave`; the server already
holds nodes, transcript and summary, so the payload stays tiny. A guest map
becomes the signed-in user's project on the first autosave (the session's
`owner_id` is claimed once and then enforced).

**Guests keep a browser-only draft.** With no account, the workspace writes
`ytmm:guest-draft` in `localStorage` (title, nodes, pointer, language, url; no
transcript). On the next visit a banner offers to restore or discard it, and the
transcript is re-fetched from YouTube. Signing in clears the local copy because
the map now belongs to the account.

**Notes and pins are per user, not per video.** Signed-in sessions never write
to `video_cache` (`cache_video_map` returns early when the session has an
`owner_id`). Guests keep using the shared cache as before. This closes the
cross-account note leak without a second table.

**Ownership is enforced in the query.** Every helper in
`app/services/projects.py` filters by `user_id`, so a foreign id is
indistinguishable from a missing one (404, never 403). `/transcript` accepts the
optional user dependency so guests can still load captions, but a `project_id`
requires the owner.

**Sharing is prepared, not implemented.** `visibility` (`private`|`unlisted`)
and a unique `share_slug` exist from the first migration; phase 3 adds the
routes and UI without another table migration.

## Consequences
- Reopening a project works offline from YouTube's perspective, and notes/pins
  are private per account.
- The shared disk cache keeps working for guests; the two persistence paths do
  not read each other.
- The dashboard is real: overview stats, recent projects, and separate lists of
  saved projects and drafts with search, rename, duplicate, delete and promote.
- A project row duplicates the transcript (roughly tens of kB per lecture). That
  is the price of not depending on YouTube still serving captions later.
- Deleting a project is permanent; there is no trash/undo yet.
