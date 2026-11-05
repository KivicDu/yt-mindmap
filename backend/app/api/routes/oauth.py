"""Google / GitHub sign-in.

The browser starts at ``GET /api/auth/{provider}``; this route redirects to the
provider with a random ``state`` also stored in a short-lived HttpOnly cookie.
The provider then redirects back to ``/api/auth/{provider}/callback``, where the
state is checked, the code is exchanged and the session cookies are set before
the browser returns to the dashboard.

Any failure redirects to the frontend ``/login`` page with
``?oauth=<provider>&error=<code>`` so the UI can explain what happened. These
routes never return JSON: a browser reaching them is always mid-redirect.
"""

from secrets import compare_digest, token_urlsafe
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.services.accounts import upsert_oauth_user
from app.services.oauth import OAuthError, build_authorize_url, exchange_code, is_configured
from app.utils.cookies import set_session_cookies

router = APIRouter(prefix="/auth", tags=["auth"])

STATE_COOKIE_PATH = "/api/auth"


def _login_redirect(error: str | None = None, provider: str | None = None) -> RedirectResponse:
    settings = get_settings()
    params: dict[str, str] = {}
    if provider:
        params["oauth"] = provider
    if error:
        params["error"] = error
    url = f"{settings.FRONTEND_URL.rstrip('/')}/login"
    if params:
        url = f"{url}?{urlencode(params)}"
    return RedirectResponse(url, status_code=302)


def _clear_state_cookie(response: RedirectResponse) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.OAUTH_STATE_COOKIE_NAME,
        path=STATE_COOKIE_PATH,
        domain=settings.COOKIE_DOMAIN,
    )


def start(provider: str) -> RedirectResponse:
    """Build the authorize URL and remember the state in a cookie."""
    if not is_configured(provider):
        return _login_redirect("oauth_not_configured", provider)

    settings = get_settings()
    state = token_urlsafe(32)
    response = RedirectResponse(build_authorize_url(provider, state), status_code=302)
    response.set_cookie(
        key=settings.OAUTH_STATE_COOKIE_NAME,
        value=f"{provider}:{state}",
        max_age=settings.OAUTH_STATE_TTL_SECONDS,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path=STATE_COOKIE_PATH,
    )
    return response


def finish(
    provider: str,
    request: Request,
    db: Session,
    code: str | None,
    state: str | None,
    error: str | None,
) -> RedirectResponse:
    """Validate the callback, sign the user in and return to the dashboard."""
    settings = get_settings()
    stored = request.cookies.get(settings.OAUTH_STATE_COOKIE_NAME) or ""

    def fail(reason: str) -> RedirectResponse:
        response = _login_redirect(reason, provider)
        _clear_state_cookie(response)
        return response

    if error:
        # The user pressed "cancel" on the provider consent screen.
        return fail("oauth_denied")
    if not code or not state:
        return fail("oauth_callback_missing_code")
    prefix = f"{provider}:"
    if not stored.startswith(prefix):
        return fail("oauth_state_mismatch")
    if not compare_digest(stored[len(prefix) :], state):
        return fail("oauth_state_mismatch")

    try:
        identity = exchange_code(provider, code)
    except OAuthError as failure:
        return fail(failure.code)

    try:
        user = upsert_oauth_user(db, identity)
    except Exception:  # noqa: BLE001 - never strand the browser on a 500
        db.rollback()
        return fail("oauth_account_error")

    response = RedirectResponse(f"{settings.FRONTEND_URL.rstrip('/')}/dashboard", status_code=302)
    _clear_state_cookie(response)
    set_session_cookies(response, user.id)
    return response


@router.get("/providers")
def providers() -> dict[str, bool]:
    """Which OAuth buttons the frontend should enable."""
    return {"google": is_configured("google"), "github": is_configured("github")}


@router.get("/google")
def google_start() -> RedirectResponse:
    return start("google")


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    return finish("google", request, db, code, state, error)


@router.get("/github")
def github_start() -> RedirectResponse:
    return start("github")


@router.get("/github/callback")
def github_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    return finish("github", request, db, code, state, error)
