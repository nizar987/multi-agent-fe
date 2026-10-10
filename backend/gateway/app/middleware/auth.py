"""
Auth middleware — validates Bearer token on every request.
Public paths (e.g. /health) are exempt.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
import structlog

from app.settings import settings

log = structlog.get_logger(__name__)

# Paths that do NOT require authentication
_PUBLIC_PATHS = {"/health", "/", "/docs", "/openapi.json", "/redoc"}


class BearerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in _PUBLIC_PATHS:
            return await call_next(request)

        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse(
                {"ok": False, "error": "missing_auth", "data": None},
                status_code=401,
            )

        token = auth[len("Bearer "):]
        if token != settings.gateway_secret:
            log.warning("auth_failed", path=request.url.path)
            return JSONResponse(
                {"ok": False, "error": "invalid_token", "data": None},
                status_code=401,
            )

        return await call_next(request)
