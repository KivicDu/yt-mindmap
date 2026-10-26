from pathlib import Path

import pytest

import main as main_module


@pytest.fixture(autouse=True)
def isolated_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Keep every test away from the real session store and cache file."""
    monkeypatch.setattr(main_module, "CACHE_PATH", tmp_path / "video_cache.json")
    main_module.sessions.clear()
    main_module.video_cache.clear()
    yield
    main_module.sessions.clear()
    main_module.video_cache.clear()
