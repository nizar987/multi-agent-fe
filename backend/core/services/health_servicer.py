"""Health servicer — responds to Ping RPC."""
import grpc
import structlog

from generated.agentplatform.v1 import health_pb2, health_pb2_grpc
from app.settings import settings

log = structlog.get_logger(__name__)


class HealthServicer(health_pb2_grpc.HealthServiceServicer):
    async def Ping(
        self,
        request: health_pb2.PingRequest,
        context: grpc.aio.ServicerContext,
    ) -> health_pb2.PingResponse:
        log.debug("health_ping")
        return health_pb2.PingResponse(ok=True, version=settings.version)
