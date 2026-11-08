# ADR 0009 — Account recovery: SMTP, password reset and email change

## Status
Accepted (Phase 5)

## Context
Phase 4 shipped profile editing, email verification and a refresh-token registry,
but three account-recovery gaps remained:

1. Verification links were a development outbox: they were written to the server
   log (and optionally returned via `DEBUG_EMAIL_LINKS`) instead of emailed, so
   the feature could not be used by a real person.
2. A user who forgot their password had no way back into the account.
3. The email address was fixed at registration, so a typo or a lost inbox made
   the account unreachable and invitations went to the wrong place.

All three need the same primitive: a single-use link delivered to an address.
Phase 4 already had that for verification (`email_verification_tokens`); the
work is to generalise the lifecycle, add a transport, and wire the two new
flows without weakening the existing token guarantees.

## Decision

### One token table with a purpose
`email_verification_tokens` is renamed to `account_tokens` and gains:

- `purpose` — `verify_email`, `password_reset` or `email_change`;
- `email` — the target address, only set for `email_change`;
- a unique constraint on `(user_id, purpose)`.

Only a SHA-256 hash of the token is stored. Tokens are single-use (`used_at`),
expire, and issuing a new token for the same purpose replaces the previous one.
TTLs are 24 hours for verification and 1 hour for password reset and email
change, because the latter two are higher risk. Password reset and email change
also have a 60-second cooldown per account; verification does not, since it only
mails the account owner.

### Email delivery
`EMAIL_BACKEND` selects the transport:

| Value | Behaviour |
| --- | --- |
| `log` (default) | writes subject and body to the backend log |
| `smtp` | sends through `SMTP_HOST`/`SMTP_PORT` with optional auth and TLS |

Sending is synchronous with `SMTP_TIMEOUT_SECONDS`, because the calling routes
are sync functions that FastAPI already runs in its threadpool. A delivery
failure raises `EmailDeliveryError`; the route discards the freshly issued token
so a retry can send immediately instead of hitting the cooldown. Verification
and email-change requests return `502 email_delivery_failed`; a password-reset
request stays generic and only logs, so delivery failures cannot be used to
probe which addresses exist.

Local testing uses [Mailpit](https://mailpit.axllent.org/) on `127.0.0.1:1025`
with its web UI on `:8025`. Production only changes environment variables.

`DEBUG_EMAIL_LINKS` remains a local convenience: when on, authenticated
verification and email-change responses include `dev_link`. Password-reset links
are never returned, because that endpoint is unauthenticated.

### Forgot / reset password
- `POST /api/auth/password/forgot` always answers `{"status":"sent"}`. It only
  issues and mails a link when the address belongs to an account with a
  password; unknown addresses and OAuth-only accounts get the same response.
- `POST /api/auth/password/reset` consumes the token, sets the new bcrypt hash,
  then revokes every refresh token, discards all other pending account tokens
  and clears the caller's cookies. Other devices must sign in again.

### Change email
- `POST /api/auth/email/request` requires a session. Password accounts must also
  supply the current password; OAuth-only accounts (`password_hash IS NULL`) rely
  on the session. The target address must not already belong to another account.
- The link goes to the **new** address, at `/confirm-email-change?token=…`.
- `POST /api/auth/email/confirm` re-checks that the address is still free,
  writes it, sets `email_verified = true`, revokes every refresh token and
  discards all pending tokens. A unique-violation race is reported as
  `409 email_taken`.
- After a successful change, a security notice is sent to the old address. A
  failure there is logged but does not undo the confirmed change.

### Frontend
Account links open SPA routes that share `AccountShell` (Calm Minimalism, same
topbar and card): `/verify-email`, `/reset-password`, `/confirm-email-change`.
`/forgot-password` is linked from the login form. The dashboard settings page
adds a "Đổi email" card next to profile, verification and password. Copy is in
Vietnamese, and every failure code has a matching message in `lib/account.ts`.

## Consequences
- A real mail server is now a deployment requirement for verification, reset
  and email change. Without one, `EMAIL_BACKEND=log` keeps development usable.
- Password reset and email change are recovery events, so they revoke all
  refresh tokens. The browser that confirmed an email change is signed out and
  must log in with the new address.
- Access tokens are still stateless and live up to 15 minutes, so a stolen
  access token is not revoked instantly; only refresh tokens are.
- Delivery is synchronous, so a slow SMTP server adds latency to those three
  endpoints. The timeout bounds it; a queue/worker can replace the call later
  without changing the token model.
- The unique `(user_id, purpose)` constraint means "one pending link per
  purpose", which is intentional: an older link must stop working when a new one
  is requested.

## Alternatives considered
- **Separate tables per purpose** — rejected: three copies of the same hash,
  expiry and single-use logic.
- **Put the target email inside the signed token** — rejected: the token would
  have to be stored or trusted without a row, and revocation/replay checks would
  be weaker than a database lookup.
- **Let password reset also sign the user in** — rejected: it would turn a
  mailed link into a session and make a leaked link more valuable. The user
  signs in with the new password instead.
- **Send the email-change link to the old address** — rejected: the point is to
  prove control of the new inbox. The old inbox gets a notice after the fact.
- **Return reset links from the API in development** — rejected: it would train
  a habit that leaks tokens and the reset endpoint is unauthenticated.
