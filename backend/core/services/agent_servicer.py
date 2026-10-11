"""
Agent servicer — gRPC implementation for AgentService.
Thin layer: validate → repository → map to proto response.
"""
import json
from typing import Optional

import grpc
import structlog

from generated.agentplatform.v1 import agent_pb2, agent_pb2_grpc, common_pb2
from db.session import AsyncSessionLocal
from domain.agents.repository import AgentRepository
from db.models import Agent

log = structlog.get_logger(__name__)


def _to_proto(a: Agent) -> agent_pb2.Agent:
    """Map ORM Agent → proto Agent."""
    tools     = a.tools     if isinstance(a.tools, list)     else json.loads(a.tools or "[]")
    skill_ids = a.skill_ids if isinstance(a.skill_ids, list) else json.loads(a.skill_ids or "[]")
    return agent_pb2.Agent(
        id             = a.id,
        name           = a.name,
        description    = a.description or "",
        system_prompt  = a.system_prompt or "",
        model_override = a.model_override or "",
        tools          = tools,
        skill_ids      = skill_ids,
        avatar         = a.avatar or "🤖",
        color          = a.color  or "#c15f3c",
        shell_auto     = bool(a.shell_auto),
        category       = a.category or "",
        created_at     = a.created_at.isoformat() if a.created_at else "",
        updated_at     = a.updated_at.isoformat() if a.updated_at else "",
    )


class AgentServicer(agent_pb2_grpc.AgentServiceServicer):

    async def ListAgents(
        self,
        request: agent_pb2.ListAgentsRequest,
        context: grpc.aio.ServicerContext,
    ) -> agent_pb2.ListAgentsResponse:
        page     = request.page.page     if request.HasField("page") else 1
        per_page = request.page.per_page if request.HasField("page") else 50
        per_page = min(max(per_page, 1), 200)
        async with AsyncSessionLocal() as session:
            repo = AgentRepository(session)
            agents, total = await repo.list_all(page=page, per_page=per_page)
        return agent_pb2.ListAgentsResponse(
            agents=[_to_proto(a) for a in agents],
            meta=common_pb2.PageMeta(total=total, page=page, per_page=per_page),
        )

    async def GetAgent(
        self,
        request: agent_pb2.GetAgentRequest,
        context: grpc.aio.ServicerContext,
    ) -> agent_pb2.Agent:
        async with AsyncSessionLocal() as session:
            agent = await AgentRepository(session).get_by_id(request.id)
        if agent is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Agent {request.id} not found")
        return _to_proto(agent)

    async def CreateAgent(
        self,
        request: agent_pb2.CreateAgentRequest,
        context: grpc.aio.ServicerContext,
    ) -> agent_pb2.Agent:
        name = (request.name or "").strip()
        if not name:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "name is required")
        async with AsyncSessionLocal() as session:
            agent = await AgentRepository(session).create(
                name          = name,
                description   = request.description or "",
                system_prompt = request.system_prompt or "",
                model_override= request.model_override or None,
                tools         = list(request.tools),
                skill_ids     = list(request.skill_ids),
                avatar        = request.avatar or "🤖",
                color         = request.color  or "#c15f3c",
                shell_auto    = request.shell_auto,
                category      = request.category or "",
            )
        log.info("agent_created", agent_id=agent.id, name=agent.name)
        return _to_proto(agent)

    async def UpdateAgent(
        self,
        request: agent_pb2.UpdateAgentRequest,
        context: grpc.aio.ServicerContext,
    ) -> agent_pb2.Agent:
        async with AsyncSessionLocal() as session:
            repo = AgentRepository(session)
            agent = await repo.update(
                request.id,
                name          = request.name or None,
                description   = request.description,
                system_prompt = request.system_prompt,
                model_override= request.model_override or None,
                tools         = list(request.tools),
                skill_ids     = list(request.skill_ids),
                avatar        = request.avatar or "🤖",
                color         = request.color  or "#c15f3c",
                shell_auto    = request.shell_auto,
                category      = request.category or "",
            )
        if agent is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Agent {request.id} not found")
        log.info("agent_updated", agent_id=request.id)
        return _to_proto(agent)

    async def DeleteAgent(
        self,
        request: agent_pb2.DeleteAgentRequest,
        context: grpc.aio.ServicerContext,
    ) -> common_pb2.Empty:
        async with AsyncSessionLocal() as session:
            deleted = await AgentRepository(session).delete(request.id)
        if not deleted:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Agent {request.id} not found")
        log.info("agent_deleted", agent_id=request.id)
        return common_pb2.Empty()
