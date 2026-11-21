"""Configuration must refuse to boot with a publicly known signing key."""

import pytest
from pydantic import ValidationError

from app.core.config import (
    DEFAULT_JWT_SECRET_KEY,
    MIN_PRODUCTION_SECRET_LENGTH,
    Settings,
)

STRONG_SECRET = "a" * MIN_PRODUCTION_SECRET_LENGTH


def make_settings(**overrides) -> Settings:
    """Build settings from defaults only, ignoring the developer's .env file."""
    return Settings(_env_file=None, **overrides)


@pytest.mark.parametrize("app_env", ["development", "test"])
def test_local_environments_allow_the_default_secret(app_env):
    settings = make_settings(APP_ENV=app_env, JWT_SECRET_KEY=DEFAULT_JWT_SECRET_KEY)
    assert settings.JWT_SECRET_KEY == DEFAULT_JWT_SECRET_KEY


@pytest.mark.parametrize("app_env", ["staging", "production"])
def test_public_environments_reject_the_default_secret(app_env):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY"):
        make_settings(APP_ENV=app_env, JWT_SECRET_KEY=DEFAULT_JWT_SECRET_KEY)


@pytest.mark.parametrize("app_env", ["staging", "production"])
@pytest.mark.parametrize("secret", ["", "   ", "too-short"])
def test_public_environments_reject_empty_or_short_secrets(app_env, secret):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY"):
        make_settings(APP_ENV=app_env, JWT_SECRET_KEY=secret)


@pytest.mark.parametrize("app_env", ["staging", "production"])
@pytest.mark.parametrize(
    "secret",
    [
        "dev-only-change-me-in-production",  # the old docker-compose fallback
        "dev-anything-at-all-long-enough-to-pass-the-length-check",
        "TEST-a-unique-looking-but-public-secret",
    ],
)
def test_public_environments_reject_development_secret_prefixes(app_env, secret):
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY"):
        make_settings(APP_ENV=app_env, JWT_SECRET_KEY=secret)


@pytest.mark.parametrize("app_env", ["staging", "production"])
def test_public_environments_accept_a_unique_secret(app_env):
    settings = make_settings(APP_ENV=app_env, JWT_SECRET_KEY=STRONG_SECRET)
    assert settings.JWT_SECRET_KEY == STRONG_SECRET
