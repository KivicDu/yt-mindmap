"""Abuse protection for the auth and AI endpoints.

Implemented as a pure ASGI middleware instead of ``BaseHTTPMiddleware`` so the
SSE stream (``/stream/{session_id}``) keeps streaming without an extra buffer.

Limits are read from settings on every request, which keeps tests and local
tuning simple. When a limit is hit the API answers ``429`` with a
``Retry-After`` header; the frontend maps both codes to Vietnamese copy.
"""

from __future__ import annotations

import math
import re

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.services.rate_limit import Limit, ai_limiter, ai_quota, auth_limiter, get_limiter
from app.utils.security import decode_token

# Only POSTs that either create accounts/sessions or can trigger an AI call.
# Refresh/logout are deliberately left out: they are called during normal
# navigation and are already protected by the refresh-token registry.
AUTH_PATHS = frozenset(
    {
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/password/forgot",
        "/api/auth/password/reset",
        "/api/auth/password",
        "/api/auth/verification/request",
        "/api/auth/verification/confirm",
        "/api/auth/email/request",
        "/api/auth/email/confirm",
        "/api/auth/account/delete",
    }
)

# These call Gemini (or can, once the session has new transcript content).
AI_PATHS = frozenset({"/transcript", "/update-map"})
# A path parameter means an exact-match set misses the restructure call, which
# is a full AI call of its own (ADR 0013). Keep this as a pattern, not a route
# string, so `/session/{id}/node` and friends stay outside the AI quota.
AI_PATH_PATTERNS = (
    re.compile(r"^/session/[^/]+/restructure$"),
    # ADR 0014: quiz generation and idea grading can both spend an AI call.
    re.compile(r"^/api/projects/[^/]+/quiz$"),
    re.compile(r"^/api/projects/[^/]+/attempt$"),
)


def is_ai_path(path: str) -> bool:
    """True for every endpoint that can spend an AI call."""
    return path in AI_PATHS or any(pattern.fullmatch(path) for pattern in AI_PATH_PATTERNS)


# GETs used to be unbounded: each one can call YouTube, query a share slug, or
# hold an SSE socket open. Paths with a parameter need patterns for the same
# reason as the AI restructure route.
GET_PATHS = frozenset({"/video-info", "/transcript/languages", "/transcript/track"})
GET_PATH_PATTERNS = (
    re.compile(r"^/stream/[^/]+$"),
    re.compile(r"^/api/share/[^/]+$"),
    re.compile(r"^/api/share/meta$"),
)


def is_get_limited(path: str) -> bool:
    """True for GET endpoints that cost an outbound call or a held socket."""
    return path in GET_PATHS or any(pattern.fullmatch(path) for pattern in GET_PATH_PATTERNS)


class RateLimitMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        settings = get_settings()
        if not settings.RATE_LIMIT_ENABLED:
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        path = scope.get("path", "")
        method = scope.get("method", "")

        if method == "GET" and is_get_limited(path):
            limit = Limit("get", settings.RATE_LIMIT_GET_PER_MINUTE)
            retry_after = get_limiter.hit(f"get:{_client_ip(request)}", limit)
            if retry_after is not None:
                await _reject(scope, receive, send, retry_after, "rate_limited")
                return

        if method == "POST" and path in AUTH_PATHS:
            limit = Limit("auth", settings.RATE_LIMIT_AUTH_PER_MINUTE)
            retry_after = auth_limiter.hit(f"auth:{_client_ip(request)}", limit)
            if retry_after is not None:
                await _reject(scope, receive, send, retry_after, "rate_limited")
                return

        if method == "POST" and is_ai_path(path):
            subject = _subject(request)
            limit = Limit("ai", settings.RATE_LIMIT_AI_PER_MINUTE)
            retry_after = ai_limiter.hit(f"ai:{subject}", limit)
            if retry_after is not None:
                await _reject(scope, receive, send, retry_after, "rate_limited")
                return

            daily_limit = (
                settings.AI_DAILY_QUOTA_PER_USER
                if subject.startswith("user:")
                else settings.AI_DAILY_QUOTA_ANONYMOUS
            )
            allowed, _ = ai_quota.consume(f"ai:{subject}", daily_limit)
            if not allowed:
                await _reject(scope, receive, send, 3600, "ai_quota_exceeded")
                return

        await self.app(scope, receive, send)


def _client_ip(request: Request) -> str:
    settings = get_settings()
    ip = request.client.host if request.client else "unknown"
    if settings.TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",", 1)[0].strip() or ip
    return ip


def _subject(request: Request) -> str:
    """Prefer the account id, so one user cannot dodge quotas with a new IP."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        payload = decode_token(header[7:], "access")
        if payload is not None and payload.get("sub"):
            return f"user:{payload['sub']}"
    return f"ip:{_client_ip(request)}"


async def _reject(scope, receive, send, retry_after: float, detail: str) -> None:
    response = JSONResponse(
        {"detail": detail},
        status_code=429,
        headers={"Retry-After": str(max(1, math.ceil(retry_after)))},
    )
    await response(scope, receive, send)
