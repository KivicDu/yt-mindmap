"""Application settings for the API, auth and database layers.

Everything is read from the environment (``backend/.env`` in development) so the
same code runs locally and on a server. The defaults are safe for a laptop but
must be overridden in production -- ``JWT_SECRET_KEY`` especially.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    APP_NAME: str = "YouTube Mind Map API"
    APP_VERSION: str = "0.3.0"
    FRONTEND_URL: str = "http://localhost:5173"

    # Database (PostgreSQL via psycopg 3)
    DATABASE_URL: str = "postgresql+psycopg://ytmindmap:ytmindmap@localhost:5432/ytmindmap"
    DATABASE_ECHO: bool = False

    # Auth
    JWT_SECRET_KEY: str = "dev-only-secret-change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
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
    AI_DAILY_QUOTA_PER_USER: int = 5000
    AI_DAILY_QUOTA_ANONYMOUS: int = 1000
    # Only enable behind a reverse proxy that overwrites X-Forwarded-For;
    # otherwise a client could spoof the header and dodge IP limits.
    TRUST_PROXY_HEADERS: bool = False

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def refresh_cookie_max_age(self) -> int:
        return self.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
