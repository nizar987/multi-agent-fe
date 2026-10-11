"""
Core gRPC server entry point.
Usage:
    python server.py
    # or via docker: CMD ["python", "server.py"]
"""
import asyncio
import logging
import os
import sys
from pathlib import Path

# Allow imports from core/ root
sys.path.insert(0, str(Path(__file__).parent))

import grpc
import structlog

from app.settings import settings
from app.logging_cfg import configure_logging
from generated.agentplatform.v1 import health_pb2_grpc
from generated.agentplatform.v1 import agent_pb2_grpc
from generated.agentplatform.v1 import skill_pb2_grpc
from generated.agentplatform.v1 import knowledge_pb2_grpc
from generated.agentplatform.v1 import log_pb2_grpc
from generated.agentplatform.v1 import settings_pb2_grpc

from services.health_servicer import HealthServicer
from services.agent_servicer import AgentServicer
from services.skill_servicer import SkillServicer
from services.knowledge_servicer import KnowledgeServicer
from services.log_servicer import LogServicer
from services.settings_servicer import SettingsServicer
from db.session import init_db

log = structlog.get_logger(__name__)


async def serve() -> None:
    configure_logging()

    # Run Alembic migrations on startup
    await init_db()

    server = grpc.aio.server(
        options=[
            ("grpc.max_send_message_length", 50 * 1024 * 1024),   # 50 MB
            ("grpc.max_receive_message_length", 50 * 1024 * 1024),
        ]
    )

    # Register all servicers
    health_pb2_grpc.add_HealthServiceServicer_to_server(HealthServicer(), server)
    agent_pb2_grpc.add_AgentServiceServicer_to_server(AgentServicer(), server)
    skill_pb2_grpc.add_SkillServiceServicer_to_server(SkillServicer(), server)
    knowledge_pb2_grpc.add_KnowledgeServiceServicer_to_server(KnowledgeServicer(), server)
    log_pb2_grpc.add_LogServiceServicer_to_server(LogServicer(), server)
    settings_pb2_grpc.add_SettingsServiceServicer_to_server(SettingsServicer(), server)

    listen_addr = f"{settings.core_host}:{settings.core_port}"
    server.add_insecure_port(listen_addr)

    log.info("core_grpc_server_starting", address=listen_addr)
    await server.start()
    log.info("core_grpc_server_ready", address=listen_addr)

    async def _shutdown(sig_name: str) -> None:
        log.info("core_grpc_server_shutdown", signal=sig_name)
        await server.stop(grace=5)

    try:
        await server.wait_for_termination()
    except asyncio.CancelledError:
        await _shutdown("CancelledError")


if __name__ == "__main__":
    asyncio.run(serve())
