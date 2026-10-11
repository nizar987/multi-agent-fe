"""Knowledge router — maps to KnowledgeService gRPC."""
from typing import Optional
import grpc
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.grpc_client import get_channel
from app.errors import grpc_error_to_http
from generated.agentplatform.v1 import knowledge_pb2, knowledge_pb2_grpc, common_pb2

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class KnowledgeCreateIn(BaseModel):
    title:    str            = Field(..., min_length=1, max_length=500)
    content:  str            = ""
    agent_id: Optional[int]  = None


def _proto_to_out(k: knowledge_pb2.KnowledgeItem) -> dict:
    return {
        "id":         k.id,
        "title":      k.title,
        "content":    k.content,
        "agent_id":   k.agent_id or None,
        "agent_name": k.agent_name,
        "created_at": k.created_at,
    }


@router.get("")
async def list_knowledge(
    agent_id: Optional[int] = Query(None),
    page:     int           = Query(1,  ge=1),
    per_page: int           = Query(50, ge=1, le=200),
):
    stub = knowledge_pb2_grpc.KnowledgeServiceStub(get_channel())
    try:
        resp = await stub.ListKnowledge(
            knowledge_pb2.ListKnowledgeRequest(
                agent_id = agent_id or 0,
                page     = common_pb2.PageRequest(page=page, per_page=per_page),
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {
        "ok":   True,
        "data": [_proto_to_out(k) for k in resp.items],
        "meta": {"total": resp.meta.total, "page": resp.meta.page, "per_page": resp.meta.per_page},
        "error": None,
    }


@router.get("/{item_id}")
async def get_knowledge(item_id: int):
    stub = knowledge_pb2_grpc.KnowledgeServiceStub(get_channel())
    try:
        item = await stub.GetKnowledge(knowledge_pb2.GetKnowledgeRequest(id=item_id))
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(item), "error": None}


@router.post("", status_code=201)
async def create_knowledge(body: KnowledgeCreateIn):
    stub = knowledge_pb2_grpc.KnowledgeServiceStub(get_channel())
    try:
        item = await stub.CreateKnowledge(
            knowledge_pb2.CreateKnowledgeRequest(
                title    = body.title.strip(),
                content  = body.content,
                agent_id = body.agent_id or 0,
            )
        )
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": _proto_to_out(item), "error": None}


@router.delete("/{item_id}")
async def delete_knowledge(item_id: int):
    stub = knowledge_pb2_grpc.KnowledgeServiceStub(get_channel())
    try:
        await stub.DeleteKnowledge(knowledge_pb2.DeleteKnowledgeRequest(id=item_id))
    except grpc.aio.AioRpcError as e:
        raise grpc_error_to_http(e)
    return {"ok": True, "data": None, "error": None}
