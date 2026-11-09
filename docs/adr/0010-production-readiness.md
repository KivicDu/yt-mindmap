# ADR 0010 — Production readiness: limits, account deletion, legal pages and backups

## Status
Accepted (Phase 6)

## Context
Phases 1–5 built the product: accounts, saved projects, sharing, collaboration
and account recovery. Before opening it to people outside the team, several
"website basics" were still missing:

1. Anonymous visitors could call the AI endpoints without limit, so anyone could
   burn the Gemini budget.
2. There was no way to delete an account, although the privacy page promised it.
3. Unknown routes silently redirected home, and a render crash produced a blank
   page.
4. Docker deployments had no SMTP configuration, so password reset only wrote
   links to the container log.
5. There were no Privacy / Terms / Contact pages.
6. Nothing backed up the Postgres volume.

## Decision

### Rate limits and AI quota
A dependency-free, in-memory limiter (`app/services/rate_limit.py`) sits in an
ASGI middleware (`app/middleware/rate_limit.py`). It is a pure ASGI middleware,
not `BaseHTTPMiddleware`, so `/stream/{session_id}` keeps streaming without an
extra buffer.

- `SlidingWindowLimiter` caps bursts per key and per rolling window. Auth POSTs
  are keyed by client IP (30/min by default); AI POSTs are keyed by account id
  when a valid access token is present, otherwise by IP (240/min).
- `DailyQuota` caps total AI calls per UTC day: 5000 per user, 1000 per
  anonymous IP. This bounds the bill even when requests are spread out.
- A rejected request gets `429` with `Retry-After` and a stable detail:
  `rate_limited` or `ai_quota_exceeded`.
- Everything is configurable (`RATE_LIMIT_*`, `AI_DAILY_QUOTA_*`,
  `TRUST_PROXY_HEADERS`) and can be disabled for tests.
- `TRUST_PROXY_HEADERS` is off by default; enabling it without a proxy that
  overwrites `X-Forwarded-For` would let a client spoof its IP.

The counters are per process, which matches the current single-worker session
store. Moving to multiple workers requires Redis; the limiter interface is
narrow so that swap stays local.

### Account deletion
`POST /api/auth/account/delete` hard-deletes immediately after confirmation:

- the caller must be signed in;
- the typed email must match the account;
- password accounts must re-enter the password (an access token alone is not
  enough for an irreversible action); OAuth-only accounts rely on the session;
- `purge_account()` removes project memberships for the email (including other
  people's projects), the user's projects and their members, refresh tokens,
  account tokens and the user row;
- cookies are cleared and a final notice is emailed. A mail failure is logged
  but does not undo the delete.

Rows are deleted explicitly instead of relying only on `ON DELETE CASCADE`
because SQLite (used by tests) does not enforce foreign keys by default and
`project_members` is keyed by email rather than user id.

### 404 and error boundaries
- `*` renders a Vietnamese `NotFound` page with links home and to the workspace.
- `ErrorBoundary` wraps the React tree, so a render crash shows a reload screen
  instead of a blank page.
- The router also has an `errorElement` for errors thrown outside that boundary.

### Legal pages
`/privacy`, `/terms` and `/contact` are template pages in Vietnamese. The
contact address comes from `VITE_CONTACT_EMAIL` (default
`contact@ytmindmap.local`) and is baked into the bundle at build time. The copy
is a starting point, not legal advice; it must be reviewed before launch.

### SMTP in Docker
`docker-compose.yml` now forwards `EMAIL_BACKEND`, the `SMTP_*` settings,
cookie flags and the rate-limit settings. An optional `mailpit` service
(`--profile mailpit`) gives a local inbox at http://localhost:8025 for testing
real delivery.

### Backups
`scripts/backup-db.sh` runs `pg_dump` inside the `db` container, gzips the dump
into `backups/` (ignored by git) and prunes files older than
`BACKUP_KEEP_DAYS` (default 14). `scripts/restore-db.sh` restores a dump after
an explicit `restore` confirmation. See
[docs/backup-restore.md](../backup-restore.md) for the runbook.

## Consequences
- Limits are best-effort per process. They stop accidental loops and casual
  abuse, not a distributed attacker. Redis or an edge limiter is the next step
  when the backend scales out.
- Anonymous users share an IP quota; a school or office NAT can hit the daily
  cap. Signing in gives a much larger per-user quota.
- Deletion is permanent. There is no trash/undo, so the confirmation copy says
  so explicitly.
- Legal copy is a template and needs review; the contact address must be set at
  build time for Docker deployments.
- Backups are only as good as the cron job and off-site copy around the script.

## Alternatives considered
- **`slowapi`** — rejected: it adds a dependency and is built around
  `BaseHTTPMiddleware`, which buffers SSE responses.
- **Soft delete with a 30-day window** — rejected for now: every query would
  need to filter `deleted_at`, and the product copy promises immediate deletion.
  A job-based purge can be added later without changing the endpoint contract.
- **Rely on database cascades only** — rejected: the test database does not
  enforce them, and email-keyed memberships need explicit cleanup anyway.
- **Return the 404 page for unknown routes with a server redirect** — rejected:
  the SPA owns routing, and a real 404 page is friendlier than a silent redirect.
