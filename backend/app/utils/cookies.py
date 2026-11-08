"""Session cookies shared by password login and OAuth callbacks.

Two cookies are written on every successful sign-in:

* ``ytmm_refresh_token`` -- HttpOnly, the only cookie that carries a secret.
  It is sent to ``/api/auth/refresh`` and never read by JavaScript.
* ``ytmm_session`` -- readable, value ``1``. It is a hint, not a credential:
  it lets the app skip a doomed ``/api/auth/refresh`` on a first visit.

Both are scoped to the API host, which is also the frontend host in local
development (``localhost:8001`` and ``localhost:5173`` share the cookie jar
because cookies are bound to the host, not the port).
"""

from fastapi import Response

from app.core.config import get_settings


def refresh_cookie_kwargs() -> dict:
    settings = get_settings()
    return {
        "key": settings.REFRESH_COOKIE_NAME,
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "domain": settings.COOKIE_DOMAIN,
        "path": "/",
    }


def set_session_cookies(response: Response, refresh_token: str) -> None:
    """Attach a pre-issued refresh token and the readable session hint."""
    settings = get_settings()
    response.set_cookie(
        value=refresh_token,
        max_age=settings.refresh_cookie_max_age,
        **refresh_cookie_kwargs(),
    )
    response.set_cookie(
        key=settings.SESSION_HINT_COOKIE_NAME,
        value="1",
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/",
        max_age=settings.refresh_cookie_max_age,
    )


def clear_session_cookies(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(**refresh_cookie_kwargs())
    response.delete_cookie(
        key=settings.SESSION_HINT_COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )
