"""Application settings for the API, auth and database layers.

Everything is read from the environment (``backend/.env`` in development) so the
same code runs locally and on a server. The defaults are safe for a laptop but
must be overridden in production -- ``JWT_SECRET_KEY`` especially.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

# Kept for local development and tests only. `APP_ENV=staging|production`
# refuses to boot with this value: a publicly known signing key makes every JWT
# forgeable.
DEFAULT_JWT_SECRET_KEY = "dev-only-secret-change-me-in-production"
MIN_PRODUCTION_SECRET_LENGTH = 32
# A different 32-character `dev-*` string is still a public signing key: the
# compose fallback was one of those and slipped past a plain length/equality
# check. Reject the whole family, not just the one default we know about.
INSECURE_SECRET_PREFIXES = ("dev-", "test-", "example-")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    APP_ENV: Literal["development", "test", "staging", "production"] = "development"
    APP_NAME: str = "YouTube Mind Map API"
    APP_VERSION: str = "0.3.0"
    FRONTEND_URL: str = "http://localhost:5173"

    # Database (PostgreSQL via psycopg 3)
    DATABASE_URL: str = "postgresql+psycopg://ytmindmap:ytmindmap@localhost:5432/ytmindmap"
    DATABASE_ECHO: bool = False

    # Auth
    JWT_SECRET_KEY: str = DEFAULT_JWT_SECRET_KEY
    JWT_ALGORITHM: str = "HS256"
    # Issuer/audience stop a token minted for another service (or a leaked
    # staging token) from being accepted here even if the signing key matches.
    JWT_ISSUER: str = "yt-mindmap"
    JWT_AUDIENCE: str = "yt-mindmap-web"
    ACCESS_TOKEN_TTL_MINUTES: int = 15
    REFRESH_TOKEN_TTL_DAYS: int = 14

    # Email delivery. "log" writes messages to the server log (development);
    # "smtp" sends through the SMTP server below. Mailpit on 127.0.0.1:1025 is
    # enough for local end-to-end testing; production needs real credentials.
    EMAIL_BACKEND: Literal["log", "smtp"] = "log"
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str = "yt-mindmap <no-reply@ytmindmap.local>"
    SMTP_STARTTLS: bool = True
    SMTP_SSL: bool = False
    SMTP_TIMEOUT_SECONDS: float = 10.0

    # Set this to true locally to also return account links from the API so the
    # UI can offer a one-click shortcut. Never enable it on a public server:
    # it bypasses the inbox and would leak password-reset links.
    DEBUG_EMAIL_LINKS: bool = False

    # Refresh cookie
    REFRESH_COOKIE_NAME: str = "ytmm_refresh_token"
    SESSION_HINT_COOKIE_NAME: str = "ytmm_session"
    COOKIE_SECURE: bool = False  # must be True behind HTTPS in production
    COOKIE_SAMESITE: str = "lax"  # "lax" locally, "none" + secure when cross-site
    COOKIE_DOMAIN: str | None = None
    # Browser origins allowed to rotate the refresh cookie. Defaults to the SPA
    # and the API host; add more only when the SPA is served elsewhere.
    REFRESH_ALLOWED_ORIGINS: str = ""

    # OAuth. Leave the client id/secret empty to keep the buttons disabled; the
    # routes then send the browser back to /login with an explanatory error.
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    # Public URL of this API. The provider callback must be registered as
    # "<OAUTH_CALLBACK_BASE>/api/auth/<provider>/callback".
    OAUTH_CALLBACK_BASE: str = "http://localhost:8001"
    OAUTH_STATE_COOKIE_NAME: str = "ytmm_oauth_state"
    OAUTH_STATE_TTL_SECONDS: int = 600

    # Abuse protection. The limiter lives in memory, so it matches the current
    # single-worker deployment; move the counters to Redis before scaling out.
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_AUTH_PER_MINUTE: int = 30
    RATE_LIMIT_AI_PER_MINUTE: int = 240
    # Outbound YouTube calls, share lookups and SSE connections are GETs, so
    # the POST-only limits do not touch them.
    RATE_LIMIT_GET_PER_MINUTE: int = 120
    AI_DAILY_QUOTA_PER_USER: int = 5000
    AI_DAILY_QUOTA_ANONYMOUS: int = 1000
    # Only enable behind a reverse proxy that overwrites X-Forwarded-For;
    # otherwise a client could spoof the header and dodge IP limits.
    TRUST_PROXY_HEADERS: bool = False

    # Layer-1 content gate. `enforce` checks every YouTube URL before a map is
    # built; `off` keeps the old "any video with captions" behaviour. The
    # allow/block lists are comma-separated channel names or 11-char video ids.
    # An empty list means "no explicit rule"; a non-empty allowlist is a
    # closed list, which is the safe way to demo or run a private instance.
    CONTENT_POLICY: Literal["off", "enforce"] = "enforce"
    CONTENT_ALLOW_CHANNELS: str = ""
    CONTENT_ALLOW_VIDEO_IDS: str = ""
    CONTENT_BLOCK_CHANNELS: str = ""
    CONTENT_BLOCK_VIDEO_IDS: str = ""
    CONTENT_MIN_DURATION_SECONDS: int = 180
    CONTENT_MIN_CUES: int = 20

    # Layer-2 classifier. One small AI call on the first cues of a new video;
    # results are cached per video, so a replay costs nothing. `off` skips the
    # call entirely (useful for offline demos and for keeping quota predictable).
    CONTENT_CLASSIFIER_ENABLED: bool = True
    CONTENT_CLASSIFIER_CUES: int = 30

    # Optional visual signal for the classifier. Off by default: it changes no
    # production behaviour until explicitly enabled. When on, a few small
    # public JPEGs (thumbnail + spread-out frames + storyboard) are attached to
    # the same classifier call, so sensitive imagery can be caught even when
    # the title and captions look harmless.
    CONTENT_VISUAL_CHECK_ENABLED: bool = False
    CONTENT_VISUAL_MAX_IMAGES: int = 6
    CONTENT_VISUAL_FETCH_TIMEOUT: float = 5.0
    CONTENT_VISUAL_MAX_BYTES: int = 1_500_000

    # Layer-3 share policy. A public link is only allowed for a project whose
    # video was confirmed as a lecture (allowlist or classifier verdict).
    # Default to closed; set false only while migrating old rows.
    CONTENT_SHARE_REQUIRE_VERIFIED: bool = True

    @model_validator(mode="after")
    def _guard_production_secret(self) -> "Settings":
        """Fail closed instead of serving forgeable tokens in production."""
        if self.APP_ENV in {"staging", "production"}:
            secret = self.JWT_SECRET_KEY.strip()
            if (
                not secret
                or secret.lower().startswith(INSECURE_SECRET_PREFIXES)
                or len(secret) < MIN_PRODUCTION_SECRET_LENGTH
            ):
                raise ValueError(
                    "JWT_SECRET_KEY must be a unique value of at least "
                    f"{MIN_PRODUCTION_SECRET_LENGTH} characters, without a "
                    f"development prefix, in {self.APP_ENV}"
                )
        return self

    @model_validator(mode="after")
    def _guard_production_cookie(self) -> "Settings":
        """A session cookie sent over plaintext HTTP is a stolen session."""
        if self.APP_ENV in {"staging", "production"}:
            if not self.COOKIE_SECURE:
                raise ValueError(
                    "COOKIE_SECURE must be true when cookies are used over "
                    f"HTTPS in {self.APP_ENV}"
                )
            if self.COOKIE_SAMESITE not in {"lax", "strict", "none"}:
                raise ValueError("COOKIE_SAMESITE must be lax, strict or none")
        return self

    @property
    def refresh_allowed_origins(self) -> set[str]:
        """Origins whose scripts may call /api/auth/refresh with the cookie."""

        def origin_of(url: str) -> str | None:
            parsed = urlsplit(url)
            if parsed.scheme in {"http", "https"} and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}"
            return None

        origins = {origin_of(self.FRONTEND_URL), origin_of(self.OAUTH_CALLBACK_BASE)}
        origins.update(
            item.strip().rstrip("/")
            for item in self.REFRESH_ALLOWED_ORIGINS.split(",")
            if item.strip()
        )
        return {value for value in origins if value}

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def refresh_cookie_max_age(self) -> int:
        return self.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
