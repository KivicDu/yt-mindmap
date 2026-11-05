"""Google and GitHub OAuth: authorize URL, code exchange, profile normalisation.

The flow is the plain server-side one:

1. ``GET /api/auth/{provider}`` redirects the browser to the provider inside an
   ``authorize`` URL carrying a random ``state`` value (also stored in a cookie).
2. The provider sends the browser back to
   ``/api/auth/{provider}/callback?code=...&state=...``.
3. The callback compares the two ``state`` values, exchanges the code for a
   token, reads the profile and signs the user in.

Nothing provider-specific leaks into the routes: this module turns whatever the
provider sends into one :class:`OAuthIdentity`.
"""

from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

PROVIDERS = ("google", "github")

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_EMAILS_URL = "https://api.github.com/user/emails"

# Providers are chained calls, so a short timeout is better than a hanging
# login button. 10s is generous for a token exchange.
HTTP_TIMEOUT_SECONDS = 10.0

# GitHub's API rejects requests without a User-Agent.
GITHUB_HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "yt-mindmap"}


class OAuthError(Exception):
    """A failure a user can act on; ``code`` is safe to show in the UI."""

    def __init__(self, code: str, *, provider: str):
        super().__init__(f"{provider}: {code}")
        self.code = code
        self.provider = provider


@dataclass(frozen=True)
class OAuthIdentity:
    """The part of a provider profile that the app actually stores."""

    provider: str
    provider_id: str
    email: str
    display_name: str
    avatar_url: str | None = None
    email_verified: bool = True


@dataclass(frozen=True)
class ProviderConfig:
    authorize_url: str
    token_url: str
    scope: str
    client_id: str
    client_secret: str


def _config(provider: str) -> ProviderConfig | None:
    """Return the credentials for one provider, or ``None`` when unconfigured."""
    settings = get_settings()
    if provider == "google":
        return ProviderConfig(
            authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
            token_url=GOOGLE_TOKEN_URL,
            scope="openid email profile",
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
        )
    if provider == "github":
        return ProviderConfig(
            authorize_url="https://github.com/login/oauth/authorize",
            token_url=GITHUB_TOKEN_URL,
            # read:user gives the profile; user:email gives the verified address.
            scope="read:user user:email",
            client_id=settings.GITHUB_CLIENT_ID,
            client_secret=settings.GITHUB_CLIENT_SECRET,
        )
    return None


def is_configured(provider: str) -> bool:
    config = _config(provider)
    return config is not None and bool(config.client_id and config.client_secret)


def redirect_uri(provider: str) -> str:
    """The URL to register in the provider's console."""
    base = get_settings().OAUTH_CALLBACK_BASE.rstrip("/")
    return f"{base}/api/auth/{provider}/callback"


def build_authorize_url(provider: str, state: str) -> str:
    config = _config(provider)
    if config is None:
        raise OAuthError("unknown_provider", provider=provider)

    params = {
        "client_id": config.client_id,
        "redirect_uri": redirect_uri(provider),
        "response_type": "code",
        "scope": config.scope,
        "state": state,
    }
    if provider == "google":
        # `offline` is not needed: only the profile is read once at login.
        params["access_type"] = "online"
        params["prompt"] = "select_account"
    return f"{config.authorize_url}?{urlencode(params)}"


def _post_form(url: str, data: dict[str, str]) -> dict:
    """Small seam so tests can replace the network without a provider."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS) as client:
        response = client.post(url, data=data, headers={"Accept": "application/json"})
    response.raise_for_status()
    return response.json()


def _get_json(url: str, token: str, headers: dict[str, str] | None = None) -> object:
    merged = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    merged.update(headers or {})
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS) as client:
        response = client.get(url, headers=merged)
    response.raise_for_status()
    return response.json()


def _exchange_code(provider: str, code: str) -> str:
    config = _config(provider)
    if config is None:
        raise OAuthError("unknown_provider", provider=provider)

    payload = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "code": code,
        "redirect_uri": redirect_uri(provider),
        "grant_type": "authorization_code",
    }
    try:
        body = _post_form(config.token_url, payload)
    except (httpx.HTTPError, ValueError) as error:
        raise OAuthError("token_exchange_failed", provider=provider) from error

    token = body.get("access_token") if isinstance(body, dict) else None
    if not isinstance(token, str) or not token:
        raise OAuthError("token_exchange_failed", provider=provider)
    return token


def _google_identity(token: str) -> OAuthIdentity:
    try:
        profile = _get_json(GOOGLE_USERINFO_URL, token)
    except (httpx.HTTPError, ValueError) as error:
        raise OAuthError("profile_fetch_failed", provider="google") from error

    if not isinstance(profile, dict):
        raise OAuthError("profile_fetch_failed", provider="google")

    email = profile.get("email")
    if not isinstance(email, str) or not email:
        raise OAuthError("email_unavailable", provider="google")
    if profile.get("email_verified") is False:
        raise OAuthError("email_unverified", provider="google")

    name = profile.get("name") or profile.get("given_name") or email.split("@")[0]
    return OAuthIdentity(
        provider="google",
        provider_id=str(profile.get("sub") or ""),
        email=email,
        display_name=str(name)[:80],
        avatar_url=profile.get("picture") or None,
    )


def _github_identity(token: str) -> OAuthIdentity:
    try:
        profile = _get_json(GITHUB_USER_URL, token, GITHUB_HEADERS)
    except (httpx.HTTPError, ValueError) as error:
        raise OAuthError("profile_fetch_failed", provider="github") from error

    if not isinstance(profile, dict):
        raise OAuthError("profile_fetch_failed", provider="github")

    email = profile.get("email")
    # `email` is null when the user keeps it private, so ask for the address
    # list and keep only an address GitHub marks as verified.
    if not isinstance(email, str) or not email:
        try:
            addresses = _get_json(GITHUB_EMAILS_URL, token, GITHUB_HEADERS)
        except (httpx.HTTPError, ValueError) as error:
            raise OAuthError("profile_fetch_failed", provider="github") from error

        verified = [
            item
            for item in (addresses if isinstance(addresses, list) else [])
            if isinstance(item, dict) and item.get("verified")
        ]
        primary = next((item for item in verified if item.get("primary")), None)
        chosen = primary or (verified[0] if verified else None)
        email = chosen.get("email") if chosen else None

    if not isinstance(email, str) or not email:
        raise OAuthError("email_unavailable", provider="github")

    name = profile.get("name") or profile.get("login") or email.split("@")[0]
    return OAuthIdentity(
        provider="github",
        provider_id=str(profile.get("id") or ""),
        email=email,
        display_name=str(name)[:80],
        avatar_url=profile.get("avatar_url") or None,
    )


def exchange_code(provider: str, code: str) -> OAuthIdentity:
    """Turn an authorization code into a normalised identity or raise OAuthError."""
    if provider not in PROVIDERS:
        raise OAuthError("unknown_provider", provider=provider)
    if not is_configured(provider):
        raise OAuthError("oauth_not_configured", provider=provider)

    token = _exchange_code(provider, code)
    identity = _google_identity(token) if provider == "google" else _github_identity(token)
    if not identity.provider_id:
        raise OAuthError("profile_fetch_failed", provider=provider)
    return identity
