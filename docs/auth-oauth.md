# OAuth setup (Google & GitHub)

The code for both providers is already in the backend. What is missing on a
fresh checkout is the **client credentials**: without them the buttons on
`/login` and `/register` stay disabled and the API sends the browser back to
`/login?oauth=<provider>&error=oauth_not_configured`.

## 1. Choose the URLs first

Both providers need the *exact* callback URL that this app will use. Locally it
is:

```
Google: http://localhost:8001/api/auth/google/callback
GitHub: http://localhost:8001/api/auth/github/callback
```

They come from `OAUTH_CALLBACK_BASE` in `backend/.env` (default
`http://localhost:8001`). In production set it to your public API origin, e.g.
`https://api.example.com`, and register the matching HTTPS URLs. Then set
`FRONTEND_URL` and `COOKIE_SECURE=true`.

> **Use `localhost`, not `127.0.0.1`, in development.** Cookies are bound to the
> host, and the API (`:8001`) and the dev server (`:5173`) only share a cookie
> jar when both are opened as `localhost`.

## 2. Google (Google Auth Platform)

The screen used to be called *APIs & Services → OAuth consent screen*. It now
lives at <https://console.cloud.google.com/auth/overview> under the name
**Google Auth Platform**, and the first visit runs a short setup wizard. A
client cannot be created before that wizard is finished.

1. Open <https://console.cloud.google.com/auth/overview>, pick (or create) a
   project in the top bar, then click **GET STARTED**.
2. Fill the wizard:
   - **App information**: *App name* `yt-mindmap`, *User support email* = your
     own address.
   - **Audience**: *External* (only pick *Internal* if you have a Google
     Workspace organisation and want to restrict sign-in to it).
   - **Contact information**: your email.
   - Accept the policy and finish.
3. Open **Clients** (<https://console.cloud.google.com/auth/clients>) →
   **CREATE CLIENT**:
   - *Application type*: **Web application**
   - *Name*: `yt-mindmap local` (keeps dev and production clients apart)
   - **Authorized JavaScript origins**: `http://localhost:5173`
   - **Authorized redirect URIs**:
     `http://localhost:8001/api/auth/google/callback`
   - **CREATE**
4. The dialog shows the **Client ID** and **Client secret**. Copy both now:
   since mid-2025 Google reveals the secret only once (later it shows just the
   last four characters). If you lose it, open the client → **Add secret**,
   update the app and disable the old one.
5. Paste into `backend/.env`:

```env
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

Notes:

- The scopes used are `openid email profile`, all non-sensitive. With only these
  Google does **not** require test users, shows no "unverified app" warning and
  the consent does not expire after 7 days even while the app is in *Testing*.
  Adding your own account under **Audience → Test users** is still harmless.
- **Data access** (<https://console.cloud.google.com/auth/scopes>) can stay
  untouched; these basic scopes need no verification.
- Keep the publishing status on *Testing* while developing. Click **Publish app**
  only when real users sign in from a public domain — and then also register the
  HTTPS redirect URI and set `COOKIE_SECURE=true`.
- Edits to origins/redirect URIs can take a few minutes to take effect.

## 3. GitHub (Developer settings)

1. Open <https://github.com/settings/developers> → **OAuth Apps** →
   **New OAuth App** (the first time the button reads
   **Register a new application**).
2. Fill in:
   - Application name: `yt-mindmap`
   - Homepage URL: `http://localhost:5173`
   - Application description: optional
   - **Authorization callback URL**:
     `http://localhost:8001/api/auth/github/callback`
     This must match exactly — scheme, host, port and path.
   - Leave *Enable Device Flow* unchecked and keep *Expire user access tokens*
     checked: the app reads the profile once and never stores a GitHub token.
3. **Register application**, then on the app page:
   - copy the **Client ID**;
   - click **Generate a new client secret** and copy it immediately (GitHub
     shows it once; you can always generate another).
4. Paste into `backend/.env`:

```env
GITHUB_CLIENT_ID=Iv1....
GITHUB_CLIENT_SECRET=...
```

The scopes used are `read:user user:email`. GitHub often hides the email on the
profile, so the backend falls back to `/user/emails` and only accepts addresses
marked **verified**; if none exists the login fails with
`error=email_unavailable`.

> For a deployed app, create a **second** OAuth app (e.g. `yt-mindmap prod`)
> pointing at the HTTPS URLs instead of editing the local one. GitHub allows
> several callback URLs per app, but one app per environment is easier to keep
> straight.

## 4. Values, restart and check

Everything the two consoles ask for, in one place (development):

| Field | Value |
|---|---|
| Google *Authorized JavaScript origins* | `http://localhost:5173` |
| Google *Authorized redirect URIs* | `http://localhost:8001/api/auth/google/callback` |
| GitHub *Homepage URL* | `http://localhost:5173` |
| GitHub *Authorization callback URL* | `http://localhost:8001/api/auth/github/callback` |
| `GOOGLE_CLIENT_ID` | ends with `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | starts with `GOCSPX-` |
| `GITHUB_CLIENT_ID` | starts with `Iv1.` (or `Ov23li…` for newer apps) |
| `GITHUB_CLIENT_SECRET` | 40-character hex string |

The API reads these at start-up, so restart it:

```bash
cd backend
# stop the running uvicorn (Ctrl-C) and start it again
./venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

```bash
curl -s http://localhost:8001/api/auth/providers
# {"google":true,"github":true}
```

Then reload `/login` (the provider list is fetched once per page load) — the
buttons stop saying “chưa cấu hình”. Clicking one should show the provider's
consent screen and land back on `/dashboard` with the account name in the
sidebar. `GET /api/docs` also lists the routes under **auth**.

If a sign-in succeeds, the database row shows the link:

```bash
psql postgresql://ytmindmap:ytmindmap@127.0.0.1:5432/ytmindmap \
  -c "select email, provider, provider_id, display_name from users;"
```

## How the flow works

```
Browser                    API (localhost:8001)              Provider
  |  GET /api/auth/google        |                                 |
  |----------------------------->| 302 + state cookie              |
  | 302 to accounts.google.com ----------------------------------->|
  |                              |                                 |
  |  GET /callback?code&state ------------------------------------>|
  |                              |  login_redirect() with cookies  |
  | 302 to /dashboard <----------|                                 |
```

- The `state` value is random (`secrets.token_urlsafe`), stored in an HttpOnly
  cookie scoped to `/api/auth`, and compared with `compare_digest` on return.
  It expires after 10 minutes.
- The callback sets the same two cookies as a password login: the HttpOnly
  refresh token and the readable `ytmm_session` hint. The SPA then calls
  `/auth/refresh` and `/auth/me` as usual — no token ever appears in the URL.
- A provider profile is normalised to `(provider, provider_id, email,
  display_name, avatar_url)`.

## Account linking

Signing in with Google/GitHub using an email that already has a password account
**links to that account** instead of creating a second one:

- `provider_id` becomes `google:<sub>` / `github:<id>`;
- the password keeps working, and `provider` stays `local` so the dashboard still
  says “Email & mật khẩu”;
- the account is marked `email_verified` because the provider verified it;
- the avatar is filled in only when it was empty.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `error=oauth_not_configured` | `*_CLIENT_ID` / `*_CLIENT_SECRET` empty in `backend/.env` (restart the API after editing). |
| `Error 401: invalid_client` / "OAuth client was not found" (Google) | Wrong or truncated `GOOGLE_CLIENT_ID`, or the client belongs to a different project than the one you configured. |
| `redirect_uri_mismatch` (Google) | The URI in the console differs from `OAUTH_CALLBACK_BASE + /api/auth/google/callback`, including the port and `http`/`https`. |
| `origin_mismatch` (Google) | `http://localhost:5173` is missing from *Authorized JavaScript origins*. Not needed for this server-side flow, but harmless to keep. |
| `redirect_uri is not associated with this application` (GitHub) | The registered callback URL must match exactly, including the port and path. |
| Google shows "access blocked" | The client is on a different project than the configured app, or the account is outside an *Internal* audience. With only `openid email profile`, *Testing* mode accepts any Google account. |
| `error=oauth_state_mismatch` | The state cookie expired (10 min) or the callback was opened twice. Start again from `/login`. |
| Signed in, then immediately logged out | Frontend and API are on different hosts (e.g. `127.0.0.1` vs `localhost`), so the cookies are not shared. Use one host name for both. |
| `error=email_unavailable` | GitHub account has no verified email address. Add one on GitHub or use email sign-up. |
| Buttons stay disabled after editing `.env` | The API caches settings per process; restart uvicorn and hard-reload `/login`. |

## Tests

`backend/tests/test_oauth.py` stubs the provider network (`_post_form`,
`_get_json` or the route's `exchange_code`), so the suite needs no credentials
and no internet. The real provider calls are the only part not covered.
