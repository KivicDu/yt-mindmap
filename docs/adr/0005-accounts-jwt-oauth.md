# ADR 0005 — Accounts: PostgreSQL, short-lived JWTs, HttpOnly refresh cookie

## Status
Accepted

## Context

Phase 1 turns the tool into a platform: people sign in, later they save projects
and share them. The workspace itself must keep working without an account, so
auth cannot become a gate in front of the mind map. Accounts need a real
relational database because projects, drafts and shares will reference users and
each other.

The frontend is a static SPA served from a different origin than the API in
development (`:5173` vs `:8001`).

## Decision

1. **PostgreSQL + SQLAlchemy 2 + Alembic.** The mind-map session/cache layer
   stays as it is (in memory + JSON); only accounts live in the database.
2. **Two tokens.**
   - Access: JWT, 15 minutes, kept in JavaScript memory, sent as
     `Authorization: Bearer`.
   - Refresh: JWT, 14 days, `HttpOnly` cookie, rotated on every refresh.
   Putting the refresh token in a cookie means XSS cannot read it, and keeping
   the access token out of `localStorage` means an injected script cannot lift a
   long-lived credential.
3. **OAuth on the server.** Google and GitHub use the authorization-code flow
   with a random `state` bound to an HttpOnly cookie. The callback sets the same
   cookies as a password login and redirects to `/dashboard`; the SPA never sees
   a token in the URL.
4. **Auto-link by verified email.** An OAuth profile whose email matches an
   existing password account attaches to it (`provider_id` records the
   identity, the password keeps working).

## Alternatives considered

- **Session cookie + server-side store.** Simpler, but needs Redis (or sticky
  sessions) before the app can run more than one worker; JWT keeps phase 1
  stateless and leaves room for a token store later.
- **Refresh token in `localStorage`.** Easier, but exposed to any XSS and not
  revocable by a cookie clear.
- **Defer OAuth until credentials exist.** The routes are written now and stay
  inert (buttons disabled, `oauth_not_configured`) until client IDs are added,
  so enabling a provider is configuration, not code.

## Consequences

- Logout clears the cookie but does not revoke a copied refresh token; a
  server-side token/`jti` denylist is the follow-up when multi-device logout
  matters.
- Cookies are host-scoped: the frontend and API must share a host name
  (`localhost` in development). Production needs `COOKIE_SECURE=true` and a
  consistent `ALLOWED_ORIGINS`.
- Adding a third provider is a `ProviderConfig` entry plus a pair of routes;
  `docs/auth-oauth.md` documents the console steps.
- Tests need no database server: they override `get_db` with an in-memory
  SQLite engine, and OAuth tests stub the provider HTTP calls.
