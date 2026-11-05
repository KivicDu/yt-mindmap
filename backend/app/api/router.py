"""Everything under /api, mounted by ``main.py``."""

from fastapi import APIRouter

from app.api.routes import auth, oauth

api_router = APIRouter()
# Password routes first so /auth/me, /auth/refresh, ... are registered before
# the OAuth router's provider endpoints.
api_router.include_router(auth.router)
api_router.include_router(oauth.router)
