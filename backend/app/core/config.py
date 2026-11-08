"""Application settings for the API, auth and database layers.

Everything is read from the environment (``backend/.env`` in development) so the
same code runs locally and on a server. The defaults are safe for a laptop but
must be overridden in production -- ``JWT_SECRET_KEY`` especially.
"""

from functools import lru_cache
from pathlib import Path

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

    # Phase 4 has no SMTP transport: verification links are written to the log.
    # Set this to true locally to also return the link from the API so the UI
    # can offer a one-click "open verification link" shortcut. Never enable it
    # on a public server.
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

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def refresh_cookie_max_age(self) -> int:
        return self.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
