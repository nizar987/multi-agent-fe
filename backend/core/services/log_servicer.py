"""
Log servicer — reads lines from the app log file on disk.
Mirrors lib/logger.ts tailLog() behaviour.
"""
import os
import grpc
import structlog

from generated.agentplatform.v1 import log_pb2, log_pb2_grpc, common_pb2

log = structlog.get_logger(__name__)

# Resolve log file path: DATA_DIR env var or ./data/logs/app.log
_LOG_FILE = os.path.join(
    os.environ.get("DATA_DIR", os.path.join(os.getcwd(), "data")),
    "logs", "app.log",
)


def _tail_lines(n: int) -> list[str]:
    try:
        with open(_LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        return [l.rstrip("\n") for l in lines[-n:]]
    except FileNotFoundError:
        return []


class LogServicer(log_pb2_grpc.LogServiceServicer):

    async def ListLogs(
        self,
        request: log_pb2.ListLogsRequest,
        context: grpc.aio.ServicerContext,
    ) -> log_pb2.ListLogsResponse:
        n = min(max(request.n or 200, 1), 1000)
        lines = _tail_lines(n)
        return log_pb2.ListLogsResponse(lines=lines)

    async def ClearLogs(
        self,
        request: log_pb2.ClearLogsRequest,
        context: grpc.aio.ServicerContext,
    ) -> common_pb2.Empty:
        try:
            open(_LOG_FILE, "w").close()
            log.info("logs_cleared")
        except OSError as e:
            await context.abort(grpc.StatusCode.INTERNAL, f"Failed to clear logs: {e}")
        return common_pb2.Empty()
