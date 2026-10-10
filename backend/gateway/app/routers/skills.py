"""Skills router — maps to SkillService gRPC."""
from typing import Optional
import grpc
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.grpc_client import get_channel
from app.errors import grpc_error_to_http
from generated.agentplatform.v1 import skill_pb2, skill_pb2_grpc, common_pb2

router = APIRouter(prefix="/api/skills", tags=["skills"])


class SkillCreateIn(BaseModel):
    name:        str = Field(..., min_length=1, max_length=200)
    description: str = ""
    content:     str = ""


class SkillUpdateIn(BaseModel):
    name:        Optional[str] = None
    description: Optional[str] = None
    content:     Optional[str] = None


def _proto_to_out(s: skill_pb2.Skill) -> dict:
    return {
        "id":          s.id,
        "name":        s.name,
        "description": s.description,
        "content":     s.content,
        "created_at":  s.created_at,
    }


@router.get("")
async def list_skills(
    page:     int = Query(1,  ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    stub = skill_pb2_grpc.SkillServiceStub(get_channel())
    try:
        resp = await stub.ListSkills(
            skill_pb2.ListSkillsRequest(
                page=common_pb2.PageRequest(page=page, per_page=per_page)
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {
        "ok":   True,
        "data": [_proto_to_out(s) for s in resp.skills],
        "meta": {"total": resp.meta.total, "page": resp.meta.page, "per_page": resp.meta.per_page},
        "error": None,
    }


@router.get("/{skill_id}")
async def get_skill(skill_id: int):
    stub = skill_pb2_grpc.SkillServiceStub(get_channel())
    try:
        skill = await stub.GetSkill(skill_pb2.GetSkillRequest(id=skill_id))
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(skill), "error": None}


@router.post("", status_code=201)
async def create_skill(body: SkillCreateIn):
    stub = skill_pb2_grpc.SkillServiceStub(get_channel())
    try:
        skill = await stub.CreateSkill(
            skill_pb2.CreateSkillRequest(
                name=body.name.strip(),
                description=body.description,
                content=body.content,
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(skill), "error": None}


@router.put("/{skill_id}")
async def update_skill(skill_id: int, body: SkillUpdateIn):
    stub = skill_pb2_grpc.SkillServiceStub(get_channel())
    try:
        skill = await stub.UpdateSkill(
            skill_pb2.UpdateSkillRequest(
                id          = skill_id,
                name        = body.name        or "",
                description = body.description or "",
                content     = body.content     or "",
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(skill), "error": None}


@router.delete("/{skill_id}")
async def delete_skill(skill_id: int):
    stub = skill_pb2_grpc.SkillServiceStub(get_channel())
    try:
        await stub.DeleteSkill(skill_pb2.DeleteSkillRequest(id=skill_id))
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": None, "error": None}
