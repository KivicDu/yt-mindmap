"""SMTP delivery: the settings decide between log and a real mail server."""

import smtplib

import pytest

from app.core.config import get_settings
from app.services import emailer


class FakeSMTP:
    instances: list["FakeSMTP"] = []

    def __init__(self, host: str, port: int, timeout: float | None = None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.logged_in: tuple[str, str] | None = None
        self.sent: list = []
        FakeSMTP.instances.append(self)

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def starttls(self) -> None:
        self.started_tls = True

    def login(self, username: str, password: str) -> None:
        self.logged_in = (username, password)

    def send_message(self, message) -> None:
        self.sent.append(message)


@pytest.fixture(autouse=True)
def reset_fake_smtp():
    FakeSMTP.instances.clear()
    yield
    FakeSMTP.instances.clear()


@pytest.fixture()
def smtp_settings(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "EMAIL_BACKEND", "smtp")
    monkeypatch.setattr(settings, "SMTP_HOST", "127.0.0.1")
    monkeypatch.setattr(settings, "SMTP_PORT", 1025)
    monkeypatch.setattr(settings, "SMTP_USERNAME", "mailer")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "secret")
    monkeypatch.setattr(settings, "SMTP_FROM", "yt-mindmap <no-reply@example.com>")
    monkeypatch.setattr(settings, "SMTP_STARTTLS", True)
    monkeypatch.setattr(settings, "SMTP_SSL", False)
    monkeypatch.setattr(settings, "SMTP_TIMEOUT_SECONDS", 3.0)
    return settings


def test_log_backend_writes_to_the_log_and_skips_smtp(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(get_settings(), "EMAIL_BACKEND", "log")
    monkeypatch.setattr(
        smtplib, "SMTP", lambda *args, **kwargs: pytest.fail("SMTP must not be used")
    )

    with caplog.at_level("INFO"):
        emailer.send_email("reader@example.com", "Xin chào", "Nội dung")

    assert "reader@example.com" in caplog.text
    assert "Nội dung" in caplog.text


def test_smtp_backend_sends_the_message(
    monkeypatch: pytest.MonkeyPatch, smtp_settings
):
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)

    emailer.send_email(
        "reader@example.com", "Xin chào", "Nội dung", "<p>Nội dung</p>"
    )

    assert len(FakeSMTP.instances) == 1
    server = FakeSMTP.instances[0]
    assert (server.host, server.port, server.timeout) == ("127.0.0.1", 1025, 3.0)
    assert server.started_tls is True
    assert server.logged_in == ("mailer", "secret")

    message = server.sent[0]
    assert message["To"] == "reader@example.com"
    assert message["From"] == "yt-mindmap <no-reply@example.com>"
    assert message["Subject"] == "Xin chào"
    assert "Nội dung" in message.get_body(preferencelist=("plain",)).get_content()
    assert "<p>Nội dung</p>" in message.get_body(preferencelist=("html",)).get_content()


def test_smtp_ssl_skips_starttls(monkeypatch: pytest.MonkeyPatch, smtp_settings):
    monkeypatch.setattr(smtp_settings, "SMTP_SSL", True)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(
        smtplib, "SMTP", lambda *args, **kwargs: pytest.fail("plain SMTP must not be used")
    )

    emailer.send_email("reader@example.com", "Xin chào", "Nội dung")

    assert FakeSMTP.instances[0].started_tls is False


def test_missing_smtp_host_is_reported(monkeypatch: pytest.MonkeyPatch, smtp_settings):
    monkeypatch.setattr(smtp_settings, "SMTP_HOST", None)

    with pytest.raises(emailer.EmailDeliveryError):
        emailer.send_email("reader@example.com", "Xin chào", "Nội dung")


def test_smtp_errors_become_email_delivery_errors(
    monkeypatch: pytest.MonkeyPatch, smtp_settings
):
    class BrokenSMTP(FakeSMTP):
        def send_message(self, message) -> None:
            raise smtplib.SMTPServerDisconnected("gone")

    monkeypatch.setattr(smtplib, "SMTP", BrokenSMTP)

    with pytest.raises(emailer.EmailDeliveryError):
        emailer.send_email("reader@example.com", "Xin chào", "Nội dung")
