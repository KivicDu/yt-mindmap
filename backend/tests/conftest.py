from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import main as main_module
from app.db.base import Base
from app.db.session import get_db
from app.services.rate_limit import reset_rate_limits

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
    main_module.sessions.clear()
    main_module.video_cache.clear()
    reset_rate_limits()
    yield
    main_module.sessions.clear()
    main_module.video_cache.clear()
    reset_rate_limits()


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
