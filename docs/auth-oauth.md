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

## 2. Google (Google Cloud Console)

1. Open <https://console.cloud.google.com/> and pick (or create) a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill the app
   name and support email. While the app is in *Testing*, add your own Google
   account under **Test users** (otherwise Google refuses the sign-in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `yt-mindmap`
   - **Authorized JavaScript origins**: `http://localhost:5173`
   - **Authorized redirect URIs**: `http://localhost:8001/api/auth/google/callback`
4. Copy the **Client ID** and **Client secret** into `backend/.env`:

```env
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

The scopes used are `openid email profile`. Google returns a verified email,
which is what the app stores.

## 3. GitHub (Developer settings)

1. Open <https://github.com/settings/developers> → **OAuth Apps → New OAuth App**.
2. Fill:
   - Application name: `yt-mindmap`
   - Homepage URL: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:8001/api/auth/github/callback`
3. Register, then **Generate a new client secret**.
4. Copy both values into `backend/.env`:

```env
GITHUB_CLIENT_ID=Iv1....
GITHUB_CLIENT_SECRET=...
```

The scopes used are `read:user user:email`. GitHub often hides the email on the
profile, so the backend falls back to `/user/emails` and only accepts addresses
marked **verified**; if none exists the login fails with
`error=email_unavailable`.

## 4. Restart and check

```bash
cd backend
./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001
curl -s http://localhost:8001/api/auth/providers
# {"google":true,"github":true}
```

Reload `/login` (the provider list is cached for the page load) — the
corresponding buttons become clickable.

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
| `redirect_uri_mismatch` (Google) | The URI in the console differs from `OAUTH_CALLBACK_BASE + /api/auth/google/callback`, including the port and `http`/`https`. |
| `redirect_uri is not associated with this application` (GitHub) | Same idea: the registered callback URL must match exactly. |
| Google says the app is not verified / access blocked | Add your account under **Test users** on the consent screen, or publish the app. |
| `error=oauth_state_mismatch` | The state cookie expired (10 min) or the callback was opened twice. Start again from `/login`. |
| Signed in, then immediately logged out | Frontend and API are on different hosts (e.g. `127.0.0.1` vs `localhost`), so the cookies are not shared. Use one host name for both. |
| `error=email_unavailable` | GitHub account has no verified email address. Add one on GitHub or use email sign-up. |

## Tests

`backend/tests/test_oauth.py` stubs the provider network (`_post_form`,
`_get_json` or the route's `exchange_code`), so the suite needs no credentials
and no internet. The real provider calls are the only part not covered.
