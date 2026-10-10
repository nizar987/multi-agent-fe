"""
Knowledge servicer — gRPC implementation for KnowledgeService.
"""
import grpc
import structlog

from generated.agentplatform.v1 import knowledge_pb2, knowledge_pb2_grpc, common_pb2
from db.session import AsyncSessionLocal
from domain.knowledge.repository import KnowledgeRepository
from db.models import Knowledge

log = structlog.get_logger(__name__)


def _to_proto(k: Knowledge) -> knowledge_pb2.KnowledgeItem:
    return knowledge_pb2.KnowledgeItem(
        id         = k.id,
        title      = k.title,
        content    = k.content,
        agent_id   = k.agent_id or 0,
        agent_name = k.agent.name if k.agent else "",
        created_at = k.created_at.isoformat() if k.created_at else "",
    )


class KnowledgeServicer(knowledge_pb2_grpc.KnowledgeServiceServicer):

    async def ListKnowledge(
        self,
        request: knowledge_pb2.ListKnowledgeRequest,
        context: grpc.aio.ServicerContext,
    ) -> knowledge_pb2.ListKnowledgeResponse:
        page     = request.page.page     if request.HasField("page") else 1
        per_page = request.page.per_page if request.HasField("page") else 50
        per_page = min(max(per_page, 1), 200)
        agent_id = request.agent_id or None
        async with AsyncSessionLocal() as session:
            items, total = await KnowledgeRepository(session).list_all(
                agent_id=agent_id, page=page, per_page=per_page
            )
        return knowledge_pb2.ListKnowledgeResponse(
            items=[_to_proto(k) for k in items],
            meta=common_pb2.PageMeta(total=total, page=page, per_page=per_page),
        )

    async def GetKnowledge(
        self,
        request: knowledge_pb2.GetKnowledgeRequest,
        context: grpc.aio.ServicerContext,
    ) -> knowledge_pb2.KnowledgeItem:
        async with AsyncSessionLocal() as session:
            item = await KnowledgeRepository(session).get_by_id(request.id)
        if item is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Knowledge {request.id} not found")
        return _to_proto(item)

    async def CreateKnowledge(
        self,
        request: knowledge_pb2.CreateKnowledgeRequest,
        context: grpc.aio.ServicerContext,
    ) -> knowledge_pb2.KnowledgeItem:
        title = (request.title or "").strip()
        if not title:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "title is required")
        async with AsyncSessionLocal() as session:
            item = await KnowledgeRepository(session).create(
                title    = title,
                content  = request.content or "",
                agent_id = request.agent_id or None,
            )
        log.info("knowledge_created", id=item.id, title=item.title)
        return _to_proto(item)

    async def DeleteKnowledge(
        self,
        request: knowledge_pb2.DeleteKnowledgeRequest,
        context: grpc.aio.ServicerContext,
    ) -> common_pb2.Empty:
        async with AsyncSessionLocal() as session:
            deleted = await KnowledgeRepository(session).delete(request.id)
        if not deleted:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Knowledge {request.id} not found")
        log.info("knowledge_deleted", id=request.id)
        return common_pb2.Empty()
