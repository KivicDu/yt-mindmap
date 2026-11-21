"""Visual sampling: bounded public JPEGs fetched through a fake client only."""

import httpx

from app.services.video_visuals import (
    JPEG_MAGIC,
    THUMBNAIL_HOST,
    candidate_urls,
    duration_from_cues,
    fetch_visuals,
)

VIDEO_ID = "abcdefghijk"


class FakeResponse:
    def __init__(self, status_code, content):
        self.status_code = status_code
        self.content = content


class FakeClient:
    """Records every URL and never opens a socket."""

    def __init__(self, routes=None):
        self.routes = routes or {}
        self.urls = []
        self.closed = False

    def get(self, url):
        self.urls.append(url)
        return self.routes.get(url, FakeResponse(404, b"not found"))

    def close(self):
        self.closed = True


def _jpeg(tag):
    return JPEG_MAGIC + tag


class TestCandidates:
    def test_short_video_uses_thumbnail_and_three_auto_frames(self):
        urls = candidate_urls(VIDEO_ID, duration=120)
        assert len(urls) == 5
        assert urls[0][0] == "thumbnail"
        assert [source for source, _ in urls[1:4]] == [
            "auto:25%",
            "auto:50%",
            "auto:75%",
        ]
        assert urls[4][0] == "storyboard:L1:M0"
        assert all(url.startswith(THUMBNAIL_HOST) for _, url in urls)
        assert all("watch?v=" not in url for _, url in urls)

    def test_long_video_adds_a_second_storyboard_sheet(self):
        urls = candidate_urls(VIDEO_ID, duration=601)
        assert len(urls) == 6
        assert [source for source, _ in urls[4:]] == [
            "storyboard:L1:M0",
            "storyboard:L1:M1",
        ]

    def test_limit_is_bounded_and_never_zero(self):
        assert len(candidate_urls(VIDEO_ID, duration=9999, limit=2)) == 2
        assert len(candidate_urls(VIDEO_ID, duration=9999, limit=0)) == 1
        assert len(candidate_urls(VIDEO_ID, duration=9999, limit=999)) == 6

    def test_malformed_video_id_produces_no_requests(self):
        assert candidate_urls("not a video id") == []
        assert candidate_urls("") == []


class TestDuration:
    def test_uses_the_end_of_the_last_cue(self):
        cues = [
            {"start": 10.0, "duration": 2.0},
            {"start": 90.0, "duration": 5.0},
            {"start": 40.0, "duration": 1.0},
        ]
        assert duration_from_cues(cues) == 95.0

    def test_ignores_malformed_entries_and_empty_input(self):
        assert duration_from_cues([]) == 0.0
        assert duration_from_cues([None, "broken", {}]) == 0.0


class TestFetch:
    def test_keeps_only_small_real_jpegs(self):
        urls = dict(candidate_urls(VIDEO_ID, duration=601))
        client = FakeClient(
            {
                urls["thumbnail"]: FakeResponse(200, _jpeg(b"thumb")),
                urls["auto:25%"]: FakeResponse(200, b"<html>login</html>"),
                urls["auto:50%"]: FakeResponse(500, _jpeg(b"error")),
                urls["auto:75%"]: FakeResponse(200, b""),
                urls["storyboard:L1:M0"]: FakeResponse(200, _jpeg(b"sheet")),
            }
        )
        # The second storyboard is larger than the cap.
        client.routes[urls["storyboard:L1:M1"]] = FakeResponse(200, b"x" * 100)

        samples = fetch_visuals(VIDEO_ID, duration=601, max_bytes=10, client=client)

        assert [sample.source for sample in samples] == ["thumbnail", "storyboard:L1:M0"]
        assert [sample.data for sample in samples] == [_jpeg(b"thumb"), _jpeg(b"sheet")]
        assert all(sample.url.startswith(THUMBNAIL_HOST) for sample in samples)
        assert len(client.urls) == 6

    def test_a_failed_request_does_not_stop_the_other_samples(self):
        urls = dict(candidate_urls(VIDEO_ID))

        class FlakyClient(FakeClient):
            def get(self, url):
                self.urls.append(url)
                if url == urls["thumbnail"]:
                    raise OSError("offline")
                return FakeResponse(200, _jpeg(b"frame"))

        samples = fetch_visuals(VIDEO_ID, client=FlakyClient())

        assert [sample.source for sample in samples] == [
            "auto:25%",
            "auto:50%",
            "auto:75%",
            "storyboard:L1:M0",
        ]

    def test_injected_client_is_never_closed(self):
        client = FakeClient({candidate_urls(VIDEO_ID)[0][1]: FakeResponse(200, _jpeg(b"x"))})
        fetch_visuals(VIDEO_ID, client=client)
        assert client.closed is False

    def test_own_client_is_always_closed(self, monkeypatch):
        created = []

        def factory(*_args, **_kwargs):
            client = FakeClient()
            created.append(client)
            return client

        monkeypatch.setattr(httpx, "Client", factory)
        assert fetch_visuals(VIDEO_ID) == []
        assert len(created) == 1
        assert created[0].closed is True

    def test_invalid_id_never_creates_a_client(self, monkeypatch):
        def must_not_run(*_args, **_kwargs):
            raise AssertionError("no client for an invalid id")

        monkeypatch.setattr(httpx, "Client", must_not_run)
        assert fetch_visuals("bad-id") == []
