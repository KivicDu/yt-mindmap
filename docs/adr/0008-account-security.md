# ADR 0008 — Account security: profile, email verification and token revocation

## Status
Accepted (Phase 4)

## Context
Phase 1–3 gave accounts a password/OAuth sign-in and a refresh cookie, but three
gaps remained:

1. Users could not change their display name or password from the dashboard.
2. `users.email_verified` existed but nothing ever set it for password accounts.
   Sharing invites are keyed by email, so an unverified address could claim an
   invitation meant for someone else.
3. Refresh tokens were stateless JWTs. Logout only cleared the browser cookie;
   a copied token kept working until it expired, and a password change could not
   sign other devices out.

Email delivery is not configured in this project yet, and adding SMTP is an
operational decision (provider, credentials, deliverability) rather than a
product one. Verification must not be blocked on it.

## Decision

### Profile and password
- `PATCH /api/auth/me` changes `display_name` (1–80 chars after trimming).
- `POST /api/auth/password` requires the current password, hashes the new one
  with bcrypt, revokes every refresh token for the account, and issues a fresh
  one for the requesting browser. Other devices must sign in again.
- OAuth-only accounts (`password_hash IS NULL`) get `password_not_set`; setting
  a first password from the dashboard is out of scope.

### Email verification
- `POST /api/auth/verification/request` issues a 32-byte random token, stores
  only its SHA-256 hash in `email_verification_tokens`, and replaces any older
  pending token for that account.
- `POST /api/auth/verification/confirm` consumes the token (single use, 24-hour
  TTL) and sets `users.email_verified = true`. It does not require a session, so
  the link works in a different browser.
- Links point at the SPA route `/verify-email?token=…` so success/error states
  keep the app's Vietnamese copy and styling.
- **Delivery is a development outbox:** the link is written to the backend log.
  With `DEBUG_EMAIL_LINKS=true` the API also returns `dev_link`, which the
  dashboard turns into a one-click shortcut for local end-to-end testing. The
  flag must stay off on public servers. Replacing the outbox with SMTP only
  changes the `deliver` step; token storage and endpoints stay the same.
- OAuth accounts inherit the provider's verified email and are treated as
  verified from the start.

### Refresh-token registry
- `refresh_tokens` stores `jti`, `user_id`, `expires_at`, `revoked_at`. Every
  issued refresh token has a row; a token is valid only while its row exists,
  is unexpired and is not revoked.
- `/auth/refresh` consumes the old row and inserts a new one (rotation). Replaying
  a consumed cookie returns `401 invalid_refresh_token`.
- `/auth/logout` revokes the presented row before clearing cookies.
- `/auth/password` revokes all rows for the account, then issues one for the
  current browser.
- Access tokens remain stateless and short-lived (15 minutes). They are not
  checked against a revocation list, so logout does not instantly invalidate an
  already-issued access token.

## Consequences
- A password change now signs out other devices, which is the expected security
  behaviour and is explained in the UI.
- Because rotation is one-shot, the frontend must not fire concurrent refreshes;
  `refreshSession()` is single-flight and shares one promise across 401s.
- Verification tokens are hashed at rest; a database dump cannot be used to
  verify an address.
- Invitations are still keyed by email, but now an owner can see whether the
  invited address is verified before trusting it.
- Until SMTP is added, verification is only usable on a machine where the
  backend log (or `dev_link`) is reachable. This is documented in the README.
- No password-reset flow and no email-change flow yet. Both would reuse the same
  token table with a different purpose column.

## Alternatives considered
- **Stateless refresh tokens with a short TTL only** — cannot revoke on logout
  or password change.
- **`token_version` on the user row** — smaller schema, but it only supports
  "revoke everything", not per-device sessions, and every request would need to
  compare a claim.
- **Email verification via a third-party service (Auth0, Clerk)** — rejected:
  the project keeps auth in-house and only needs a token lifecycle.
- **Returning the verification token in production responses** — rejected: it
  would let anyone who can call the endpoint verify an address they do not own.
