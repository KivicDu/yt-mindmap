"""Short-lived capabilities for the SSE stream.

A browser cannot set an Authorization header on ``EventSource``. Passing an
access token in the query string would leak it into logs, so the API mints an
opaque, short-lived ticket after the normal authenticated request. The stream
then resolves the ticket to a user and re-checks share membership while it is
open, which lets a revoked link or removed collaborator close a live stream.
"""

from __future__ import annotations

import re
import secrets
import time
from typing import Any

TICKET_TTL_SECONDS = 60 * 60
TICKET_RE = re.compile(r"[A-Za-z0-9_-]{32}\Z")
MAX_TICKETS_PER_SESSION = 8


def issue(session: dict[str, Any], user_id: str | None = None) -> tuple[str, int]:
    """Create a ticket bound to one identity and store it on the session."""
    tickets = session.setdefault("stream_tickets", {})
    now = time.time()
    for ticket in [value for value, record in tickets.items() if record["expires_at"] <= now]:
        tickets.pop(ticket, None)
    # A leaked session id must not let a caller fill memory with tickets.
    while len(tickets) >= MAX_TICKETS_PER_SESSION:
        oldest = min(tickets, key=lambda value: tickets[value]["expires_at"])
        tickets.pop(oldest, None)

    ticket = secrets.token_urlsafe(24)
    tickets[ticket] = {"user_id": user_id, "expires_at": now + TICKET_TTL_SECONDS}
    return ticket, TICKET_TTL_SECONDS


def resolve(
    sessions: dict[str, dict[str, Any]], ticket: str
) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
    """Look up a valid ticket without trusting its shape or length."""
    if not TICKET_RE.fullmatch(ticket):
        return None
    for session_id, session in list(sessions.items()):
        record = (session.get("stream_tickets") or {}).get(ticket)
        if record is None:
            continue
        if record["expires_at"] <= time.time():
            session["stream_tickets"].pop(ticket, None)
            return None
        return session_id, session, record
    return None
