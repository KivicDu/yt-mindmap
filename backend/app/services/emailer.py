"""Deliver account emails through SMTP or the development log.

``EMAIL_BACKEND=log`` (the default) writes the message to the server log, which
is what local development uses when no mail server is running.
``EMAIL_BACKEND=smtp`` sends through the configured SMTP server; Mailpit on
``127.0.0.1:1025`` is enough for local end-to-end testing.

Sending is synchronous because the routes that call it are sync functions and
FastAPI already runs them in a worker thread. A short timeout keeps a broken
mail server from holding a request open.
"""

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(RuntimeError):
    """Raised when an email could not be handed to the mail server."""


def send_email(to: str, subject: str, text: str, html: str | None = None) -> None:
    settings = get_settings()

    if settings.EMAIL_BACKEND == "log":
        logger.info("Email to %s\nSubject: %s\n\n%s", to, subject, text)
        return

    if not settings.SMTP_HOST:
        raise EmailDeliveryError("smtp_not_configured")

    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")

    try:
        if settings.SMTP_SSL:
            server = smtplib.SMTP_SSL(
                settings.SMTP_HOST,
                settings.SMTP_PORT,
                timeout=settings.SMTP_TIMEOUT_SECONDS,
            )
        else:
            server = smtplib.SMTP(
                settings.SMTP_HOST,
                settings.SMTP_PORT,
                timeout=settings.SMTP_TIMEOUT_SECONDS,
            )

        with server:
            if settings.SMTP_STARTTLS and not settings.SMTP_SSL:
                server.starttls()
            if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        logger.exception("Could not send email to %s", to)
        raise EmailDeliveryError("smtp_send_failed") from exc
