"""Google and GitHub OAuth: authorize URL, code exchange, profile normalisation.

The flow is the plain server-side one:

1. ``GET /api/auth/{provider}`` redirects the browser to the provider inside an
   ``authorize`` URL carrying a random ``state`` and a PKCE S256 challenge.
   Both the state and the matching code verifier are stored in a short-lived
   HttpOnly cookie.
2. The provider sends the browser back to
   ``/api/auth/{provider}/callback?code=...&state=...``.
3. The callback compares the state and redeems the code with the verifier,
   then reads the profile and signs the user in.

Nothing provider-specific leaks into the routes: this module turns whatever the
provider sends into one :class:`OAuthIdentity`.
"""

import base64
import hashlib
import re
import secrets
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

# PKCE S256: the verifier stays in a short-lived HttpOnly cookie; only its hash
# goes to the provider, so an intercepted authorization code cannot be redeemed.
PKCE_METHOD = "S256"
PKCE_VERIFIER_BYTES = 48  # token_urlsafe -> 64 URL-safe characters
PKCE_VERIFIER_RE = re.compile(r"[A-Za-z0-9._~-]{43,128}\Z")


def new_code_verifier() -> str:
    """Return a fresh verifier that satisfies RFC 7636 for both providers."""
    return secrets.token_urlsafe(PKCE_VERIFIER_BYTES)


def code_challenge(verifier: str) -> str:
    """S256 challenge: base64url(SHA-256(verifier)) without padding."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


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


def build_authorize_url(provider: str, state: str, code_challenge_value: str) -> str:
    config = _config(provider)
    if config is None:
        raise OAuthError("unknown_provider", provider=provider)
    if not PKCE_VERIFIER_RE.fullmatch(code_challenge_value):
        raise OAuthError("pkce_invalid", provider=provider)

    params = {
        "client_id": config.client_id,
        "redirect_uri": redirect_uri(provider),
        "response_type": "code",
        "scope": config.scope,
        "state": state,
        "code_challenge": code_challenge_value,
        "code_challenge_method": PKCE_METHOD,
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


def _exchange_code(provider: str, code: str, code_verifier: str) -> str:
    config = _config(provider)
    if config is None:
        raise OAuthError("unknown_provider", provider=provider)
    if not PKCE_VERIFIER_RE.fullmatch(code_verifier):
        raise OAuthError("pkce_invalid", provider=provider)

    payload = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "code": code,
        "redirect_uri": redirect_uri(provider),
        "grant_type": "authorization_code",
        "code_verifier": code_verifier,
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
    # A missing claim is not consent: treat it exactly like an explicit false.
    if profile.get("email_verified") is not True:
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

    # The public profile `email` may be unverified; GitHub's own email list is
    # the only source we trust. Check it even when the profile has an address.
    try:
        addresses = _get_json(GITHUB_EMAILS_URL, token, GITHUB_HEADERS)
    except (httpx.HTTPError, ValueError) as error:
        raise OAuthError("profile_fetch_failed", provider="github") from error

    verified = [
        item
        for item in (addresses if isinstance(addresses, list) else [])
        if isinstance(item, dict)
        and item.get("verified") is True
        and isinstance(item.get("email"), str)
        and item["email"].strip()
    ]
    if not verified:
        raise OAuthError("email_unavailable", provider="github")

    profile_email = profile.get("email")
    if isinstance(profile_email, str) and profile_email:
        wanted = profile_email.strip().lower()
        if not any(item["email"].strip().lower() == wanted for item in verified):
            raise OAuthError("email_unverified", provider="github")

    primary = next((item for item in verified if item.get("primary") is True), None)
    chosen = primary or verified[0]
    email = chosen["email"].strip()

    name = profile.get("name") or profile.get("login") or email.split("@")[0]
    return OAuthIdentity(
        provider="github",
        provider_id=str(profile.get("id") or ""),
        email=email,
        display_name=str(name)[:80],
        avatar_url=profile.get("avatar_url") or None,
        email_verified=True,
    )


def exchange_code(provider: str, code: str, code_verifier: str) -> OAuthIdentity:
    """Turn an authorization code into a normalised identity or raise OAuthError."""
    if provider not in PROVIDERS:
        raise OAuthError("unknown_provider", provider=provider)
    if not is_configured(provider):
        raise OAuthError("oauth_not_configured", provider=provider)

    token = _exchange_code(provider, code, code_verifier)
    identity = _google_identity(token) if provider == "google" else _github_identity(token)
    if not identity.provider_id:
        raise OAuthError("profile_fetch_failed", provider=provider)
    return identity
