"""Layer-3 share policy: only confirmed lectures may get a public link."""

import pytest
from fastapi.testclient import TestClient
from test_content_classifier import VERDICT, FakeAI
from test_content_policy import fake_captions, fake_oembed
from test_sharing import create_project, register

import main as main_module
from app.core.config import get_settings
from app.models.project import Project
from app.services import content_classifier

UNVERIFIED_BODY = {
    "code": "content_not_verified",
    "message": "Chỉ bài giảng đã được xác nhận mới được bật link công khai.",
}


@pytest.fixture()
def enforced(monkeypatch):
    monkeypatch.setattr(get_settings(), "CONTENT_SHARE_REQUIRE_VERIFIED", True)
    yield


def _put_share(client: TestClient, headers, project_id: str, enabled: bool = True):
    return client.put(
        f"/api/projects/{project_id}/share",
        json={"enabled": enabled, "access": "anyone", "role": "viewer"},
        headers=headers,
    )


def _verify(db_session, project_id: str, value: bool = True) -> None:
    project = db_session.get(Project, project_id)
    project.content_verified = value
    db_session.commit()


def test_unverified_project_cannot_enable_a_public_link(client, enforced):
    owner = register(client)
    project = create_project(client, owner)

    response = _put_share(client, owner, project["id"])

    assert response.status_code == 422
    assert response.json()["detail"] == UNVERIFIED_BODY
    settings = client.get(f"/api/projects/{project['id']}/share", headers=owner).json()
    assert settings["enabled"] is False
    assert settings["shareable"] is False


def test_verified_project_can_enable_a_public_link(client, db_session, enforced):
    owner = register(client)
    project = create_project(client, owner)
    _verify(db_session, project["id"])

    response = _put_share(client, owner, project["id"])

    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["content_verified"] is True
    assert body["shareable"] is True
    assert body["slug"].startswith("YTMM-")


def test_rotating_a_link_also_needs_verification(client, db_session, enforced):
    owner = register(client)
    project = create_project(client, owner)
    _verify(db_session, project["id"])
    assert _put_share(client, owner, project["id"]).status_code == 200
    _verify(db_session, project["id"], False)

    response = client.post(f"/api/projects/{project['id']}/share/rotate", json={}, headers=owner)

    assert response.status_code == 422
    assert response.json()["detail"] == UNVERIFIED_BODY


def test_turning_sharing_off_is_always_allowed(client, db_session, enforced):
    owner = register(client)
    project = create_project(client, owner)
    _verify(db_session, project["id"])
    slug = _put_share(client, owner, project["id"]).json()["slug"]
    _verify(db_session, project["id"], False)

    response = _put_share(client, owner, project["id"], enabled=False)

    assert response.status_code == 200
    assert response.json()["enabled"] is False
    assert client.get(f"/api/share/{slug}").status_code == 404


def test_an_old_slug_stops_serving_when_the_project_is_demoted(client, db_session, enforced):
    owner = register(client)
    project = create_project(client, owner)
    _verify(db_session, project["id"])
    slug = _put_share(client, owner, project["id"]).json()["slug"]
    assert client.get(f"/api/share/{slug}").status_code == 200

    _verify(db_session, project["id"], False)

    assert client.get(f"/api/share/{slug}").status_code == 404
    meta = client.get("/api/share/meta", params={"slug": slug}).text
    assert "og:title" in meta
    assert project["title"] not in meta


def test_share_settings_report_the_reason_for_a_disabled_switch(client, enforced):
    owner = register(client)
    project = create_project(client, owner)

    body = client.get(f"/api/projects/{project['id']}/share", headers=owner).json()

    assert body["content_verified"] is False
    assert body["shareable"] is False


class TestVerdictPropagation:
    @pytest.fixture(autouse=True)
    def url_setup(self, monkeypatch):
        settings = get_settings()
        monkeypatch.setattr(settings, "CONTENT_POLICY", "enforce")
        monkeypatch.setattr(settings, "CONTENT_CLASSIFIER_ENABLED", True)
        for name in (
            "CONTENT_ALLOW_CHANNELS",
            "CONTENT_ALLOW_VIDEO_IDS",
            "CONTENT_BLOCK_CHANNELS",
            "CONTENT_BLOCK_VIDEO_IDS",
        ):
            monkeypatch.setattr(settings, name, "")
        content_classifier.reset_classifier_cache()
        fake_oembed(monkeypatch)
        fake_captions(monkeypatch)

    def _post(self):
        return TestClient(main_module.app).post(
            "/transcript", json={"url": "https://youtu.be/abcdefghijk"}
        )

    def test_allowlist_marks_the_session_as_verified(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "CONTENT_ALLOW_VIDEO_IDS", "abcdefghijk")
        monkeypatch.setattr(content_classifier, "ai_engine", FakeAI(refuse=True))

        body = self._post().json()

        assert body["content_verified"] is True
        assert next(iter(main_module.sessions.values()))["content_verified"] is True

    def test_classifier_lecture_marks_the_session_as_verified(self, monkeypatch):
        monkeypatch.setattr(content_classifier, "ai_engine", FakeAI([VERDICT]))

        body = self._post().json()

        assert body["content_verified"] is True

    def test_heuristics_alone_are_not_a_confirmation(self, monkeypatch):
        unverified = {"label": "unverified", "reason": "ai_error", "confidence": 0.0}
        monkeypatch.setattr(content_classifier, "ai_engine", FakeAI([unverified]))

        body = self._post().json()

        # The map is allowed, but it cannot be published as a confirmed lecture.
        assert body["content_label"] == "lecture"
        assert body["content_verified"] is False

    def test_uploaded_subtitles_are_never_verified(self):
        response = TestClient(main_module.app).post(
            "/transcript",
            json={"file_content": "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhello"},
        )

        assert response.status_code == 200
        assert next(iter(main_module.sessions.values()))["content_verified"] is False
