from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import ai_engine as ai_module
import main as main_module
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.services.content_classifier import reset_classifier_cache
from app.services.rate_limit import reset_rate_limits
from app.services.review import reset_quiz_cache

# SQLite is a test double only: models use portable column types and the app
# itself runs on PostgreSQL. StaticPool keeps one in-memory database alive
# across sessions for the duration of a test.
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture(autouse=True)
def isolated_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Keep every test away from the real session store and cache file."""
    monkeypatch.setattr(main_module, "CACHE_PATH", tmp_path / "video_cache.json")
    # Existing fixtures use tiny fake transcripts; the content gate is tested
    # explicitly in test_content_policy.py with the policy turned on. Settings
    # are patched in place: other fixtures mutate the cached object too.
    settings = get_settings()
    monkeypatch.setattr(settings, "CONTENT_POLICY", "off")
    # The classifier is exercised explicitly in its own tests. Keeping it off
    # here means no test can reach a real Gemini key from the local .env.
    monkeypatch.setattr(settings, "CONTENT_CLASSIFIER_ENABLED", False)
    # Visual sampling is a separate opt-in; keep tests from opening sockets.
    monkeypatch.setattr(settings, "CONTENT_VISUAL_CHECK_ENABLED", False)
    # No test may ever reach the model provider. The real engine is constructed
    # at import time and may hold a client; replace it with the offline branch.
    monkeypatch.setattr(ai_module.ai_engine, "client", None)
    # Older sharing fixtures create projects directly, without a video verdict.
    # Layer 3 is exercised explicitly in test_share_policy.py with it enabled.
    monkeypatch.setattr(settings, "CONTENT_SHARE_REQUIRE_VERIFIED", False)
    reset_classifier_cache()
    reset_quiz_cache()
    main_module.sessions.clear()
    main_module.video_cache.clear()
    reset_rate_limits()
    yield
    main_module.sessions.clear()
    main_module.video_cache.clear()
    reset_rate_limits()
    reset_quiz_cache()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    Base.metadata.create_all(engine)

    def override_get_db() -> Iterator[Session]:
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    main_module.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main_module.app) as test_client:
        yield test_client
    main_module.app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(engine)


@pytest.fixture()
def db_session(client: TestClient) -> Iterator[Session]:
    """A session on the same in-memory database the test client uses."""
    with TestingSession() as session:
        yield session
