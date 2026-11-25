# Production deployment handoff

This runbook deliberately contains **no secret values**. Fill every placeholder
from your own secret manager or the provider consoles; never paste values into
chat, tickets, logs or this file.

## 1. Rotate the credentials (owner action)

Do these in the provider consoles, not in the repository:

| Credential | Where to rotate | Effect after rollout |
|---|---|---|
| `JWT_SECRET_KEY` | Generate a new high-entropy value locally and store it in the secret manager. | Every existing access/refresh token is invalid; everyone signs in again. |
| `GEMINI_API_KEY` | Create a new key in the AI provider console, then disable the old one **after** the new backend is healthy. | No change to user sessions. |
| `GOOGLE_CLIENT_SECRET` | Create a new client secret in the Google console, then retire the old one. | No change to user sessions. |
| `GITHUB_CLIENT_SECRET` | Regenerate the client secret in the GitHub OAuth app settings, then retire the old one. | No change to user sessions. |

Never read or echo these values on a shared terminal. Set them through the
secret manager's normal injection path.

## 2. Required production settings

Names only; all values come from step 1 or from your deployment plan.

- App: `APP_ENV=production`, `FRONTEND_URL`, `OAUTH_CALLBACK_BASE`.
- Database: `DATABASE_URL`.
- Signing: `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `JWT_ISSUER`, `JWT_AUDIENCE`.
- Cookies: `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN`,
  `REFRESH_ALLOWED_ORIGINS`. The app refuses to boot in production unless
  `COOKIE_SECURE` is true, the same-site value is valid, and the signing key is
  long and unique. `DEBUG_EMAIL_LINKS` must stay false.
- Mail: `EMAIL_BACKEND=smtp` plus the `SMTP_*` variables. The log backend is for
  local development only; it redacts one-time links but is not a mail service.
- OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`. The registered callback URLs must match
  `<OAUTH_CALLBACK_BASE>/api/auth/<provider>/callback` exactly.
- Content gate: `CONTENT_POLICY`, `CONTENT_ALLOW_*`, `CONTENT_BLOCK_*`,
  `CONTENT_SHARE_REQUIRE_VERIFIED` and the `CONTENT_CLASSIFIER_*` /
  `CONTENT_VISUAL_*` flags. Keep the share requirement on unless you are
  deliberately migrating old rows.
- Abuse limits: `RATE_LIMIT_*`, `AI_DAILY_QUOTA_*`, `TRUST_PROXY_HEADERS`. Only
  enable proxy trust behind a proxy that overwrites `X-Forwarded-For`.
- Frontend build: `VITE_API_BASE`, `VITE_CONTACT_EMAIL`. These are baked into
  the bundle, so a change requires a frontend rebuild.

## 3. Deploy order

1. Take a database backup (`./scripts/backup-db.sh`) and copy it off the host.
2. Inject the rotated values from step 1. Do not write them into tracked files.
3. Run `alembic upgrade head` — this includes `0011_refresh_token_family`.
4. Deploy backend **and** frontend together. Older frontends still call
   `/stream/{session_id}` and will be rejected by the ticket-based stream.
5. Smoke test with curl, without printing any response that carries a token:
   - `GET /healthz` returns only `{"status":"ok"}`.
   - `GET /api/auth/providers` reports the configured providers.
   - Sign in from the real SPA, open a project, and confirm the SSE stream stays
     connected (the frontend mints its own stream ticket).
   - Refresh once from the SPA origin; a cross-origin refresh must return 403.
6. Confirm mail delivery through SMTP (verify, reset, email change) using a real
   inbox, not the server log.
7. Retire the old provider keys/secrets only after the checks above pass.

## 4. Rollback notes

- Rolling back the code while keeping migration `0011` is safe: extra nullable
  columns and indexes do not break the previous schema.
- Rolling back the signing key restores old tokens, but also restores the
  reason it was rotated. Prefer asking users to sign in again.
- A broken OAuth callback after rotation usually means the registered redirect
  URI no longer matches `OAUTH_CALLBACK_BASE`; fix the console setting, not the
  callback route.

## 5. Explicitly out of scope here

- No secret value is stored in this repository or in chat.
- `docker-compose.yml` and `docs/report/` are local-only working files and must
  stay out of commits.
- The actual key rotation and the actual deploy are performed by the owner in
  the provider consoles and on the host.
