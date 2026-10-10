"""
Agents router — REST endpoints that map to AgentService gRPC calls.
Maintains path compatibility with the existing Next.js API routes.
"""
from typing import Optional
import grpc
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.grpc_client import get_channel
from app.errors import grpc_error_to_http
from generated.agentplatform.v1 import agent_pb2, agent_pb2_grpc, common_pb2

router = APIRouter(prefix="/api/agents", tags=["agents"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class AgentOut(BaseModel):
    id:             int
    name:           str
    description:    str
    system_prompt:  str
    model_override: str
    tools:          list[str]
    skill_ids:      list[int]
    avatar:         str
    color:          str
    shell_auto:     bool
    category:       str
    created_at:     str
    updated_at:     str


class AgentCreateIn(BaseModel):
    name:           str              = Field(..., min_length=1, max_length=200)
    description:    str              = ""
    system_prompt:  str              = ""
    model_override: Optional[str]    = None
    tools:          list[str]        = []
    skill_ids:      list[int]        = []
    avatar:         str              = "🤖"
    color:          str              = "#c15f3c"
    shell_auto:     bool             = False
    category:       str              = ""


class AgentUpdateIn(BaseModel):
    name:           Optional[str]    = None
    description:    Optional[str]    = None
    system_prompt:  Optional[str]    = None
    model_override: Optional[str]    = None
    tools:          Optional[list[str]]  = None
    skill_ids:      Optional[list[int]]  = None
    avatar:         Optional[str]    = None
    color:          Optional[str]    = None
    shell_auto:     Optional[bool]   = None
    category:       Optional[str]    = None


def _proto_to_out(a: agent_pb2.Agent) -> dict:
    return {
        "id":             a.id,
        "name":           a.name,
        "description":    a.description,
        "system_prompt":  a.system_prompt,
        "model_override": a.model_override,
        "tools":          list(a.tools),
        "skill_ids":      list(a.skill_ids),
        "avatar":         a.avatar,
        "color":          a.color,
        "shell_auto":     a.shell_auto,
        "category":       a.category,
        "created_at":     a.created_at,
        "updated_at":     a.updated_at,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_agents(
    page:     int = Query(1,  ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    stub = agent_pb2_grpc.AgentServiceStub(get_channel())
    try:
        resp = await stub.ListAgents(
            agent_pb2.ListAgentsRequest(
                page=common_pb2.PageRequest(page=page, per_page=per_page)
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {
        "ok":   True,
        "data": [_proto_to_out(a) for a in resp.agents],
        "meta": {"total": resp.meta.total, "page": resp.meta.page, "per_page": resp.meta.per_page},
        "error": None,
    }


@router.get("/{agent_id}")
async def get_agent(agent_id: int):
    stub = agent_pb2_grpc.AgentServiceStub(get_channel())
    try:
        agent = await stub.GetAgent(agent_pb2.GetAgentRequest(id=agent_id))
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(agent), "error": None}


@router.post("", status_code=201)
async def create_agent(body: AgentCreateIn):
    stub = agent_pb2_grpc.AgentServiceStub(get_channel())
    try:
        agent = await stub.CreateAgent(
            agent_pb2.CreateAgentRequest(
                name           = body.name.strip(),
                description    = body.description,
                system_prompt  = body.system_prompt,
                model_override = body.model_override or "",
                tools          = body.tools,
                skill_ids      = body.skill_ids,
                avatar         = body.avatar,
                color          = body.color,
                shell_auto     = body.shell_auto,
                category       = body.category,
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(agent), "error": None}


@router.put("/{agent_id}")
async def update_agent(agent_id: int, body: AgentUpdateIn):
    stub = agent_pb2_grpc.AgentServiceStub(get_channel())
    try:
        agent = await stub.UpdateAgent(
            agent_pb2.UpdateAgentRequest(
                id             = agent_id,
                name           = body.name           or "",
                description    = body.description    or "",
                system_prompt  = body.system_prompt  or "",
                model_override = body.model_override or "",
                tools          = body.tools          or [],
                skill_ids      = body.skill_ids      or [],
                avatar         = body.avatar         or "",
                color          = body.color          or "",
                shell_auto     = body.shell_auto      if body.shell_auto is not None else False,
                category       = body.category       or "",
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(agent), "error": None}


@router.delete("/{agent_id}", status_code=200)
async def delete_agent(agent_id: int):
    stub = agent_pb2_grpc.AgentServiceStub(get_channel())
    try:
        await stub.DeleteAgent(agent_pb2.DeleteAgentRequest(id=agent_id))
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": None, "error": None}
