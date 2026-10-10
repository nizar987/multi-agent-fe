"""
Gateway FastAPI application — entry point.
Responsibilities:
  - Mount all REST routers
  - Auth middleware (Bearer token)
  - Lifespan: open/close gRPC channel
  - /health endpoint (public)
  - Consistent error response format
"""
import structlog
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.logging_cfg import configure_logging
from app.settings import settings
from app.grpc_client import get_channel, close_channel
from app.middleware.auth import BearerAuthMiddleware
from app.errors import grpc_error_to_http
from app.routers import agents, skills, knowledge, logs, settings as settings_router

import grpc

log = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.log_level)
    log.info("gateway_starting", version=settings.version, core=settings.core_address)
    # Eagerly open gRPC channel so first request doesn't pay connection cost
    get_channel()
    log.info("gateway_ready")
    yield
    log.info("gateway_shutting_down")
    await close_channel()


app = FastAPI(
    title="Agent Platform Gateway",
    version=settings.version,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(BearerAuthMiddleware)


# ── Global exception handlers ─────────────────────────────────────────────────
@app.exception_handler(grpc.aio.AioRpcError)
async def grpc_exception_handler(request: Request, exc: grpc.aio.AioRpcError):
    http_exc = grpc_error_to_http(exc)
    return JSONResponse(
        status_code=http_exc.status_code,
        content={"ok": False, "error": http_exc.detail, "data": None},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_exception", path=str(request.url.path), error=str(exc))
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": "internal_error", "data": None},
    )


# ── Public health endpoint ────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
async def health():
    """
    Gateway health check — also pings the core gRPC service.
    Public (no auth required).
    """
    from generated.agentplatform.v1 import health_pb2, health_pb2_grpc
    stub = health_pb2_grpc.HealthServiceStub(get_channel())
    try:
        resp = await stub.Ping(health_pb2.PingRequest(), timeout=5)
        return {
            "ok": True,
            "data": {
                "gateway": settings.version,
                "core":    resp.version,
                "core_ok": resp.ok,
            },
            "error": None,
        }
    except grpc.aio.AioRpcError as e:
        log.error("health_core_unreachable", code=str(e.code()), detail=e.details())
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "data": {"gateway": settings.version, "core_ok": False},
                "error": "core_unavailable",
            },
        )


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(agents.router)
app.include_router(skills.router)
app.include_router(knowledge.router)
app.include_router(logs.router)
app.include_router(settings_router.router)


# ── Dev entrypoint ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_config=None,  # structlog handles logging
    )
