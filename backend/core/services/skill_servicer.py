"""
Skill servicer — gRPC implementation for SkillService.
"""
import grpc
import structlog

from generated.agentplatform.v1 import skill_pb2, skill_pb2_grpc, common_pb2
from db.session import AsyncSessionLocal
from domain.skills.repository import SkillRepository
from db.models import Skill

log = structlog.get_logger(__name__)


def _to_proto(s: Skill) -> skill_pb2.Skill:
    return skill_pb2.Skill(
        id          = s.id,
        name        = s.name,
        description = s.description or "",
        content     = s.content,
        created_at  = s.created_at.isoformat() if s.created_at else "",
    )


class SkillServicer(skill_pb2_grpc.SkillServiceServicer):

    async def ListSkills(
        self,
        request: skill_pb2.ListSkillsRequest,
        context: grpc.aio.ServicerContext,
    ) -> skill_pb2.ListSkillsResponse:
        page     = request.page.page     if request.HasField("page") else 1
        per_page = request.page.per_page if request.HasField("page") else 50
        per_page = min(max(per_page, 1), 200)
        async with AsyncSessionLocal() as session:
            skills, total = await SkillRepository(session).list_all(page=page, per_page=per_page)
        return skill_pb2.ListSkillsResponse(
            skills=[_to_proto(s) for s in skills],
            meta=common_pb2.PageMeta(total=total, page=page, per_page=per_page),
        )

    async def GetSkill(
        self,
        request: skill_pb2.GetSkillRequest,
        context: grpc.aio.ServicerContext,
    ) -> skill_pb2.Skill:
        async with AsyncSessionLocal() as session:
            skill = await SkillRepository(session).get_by_id(request.id)
        if skill is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Skill {request.id} not found")
        return _to_proto(skill)

    async def CreateSkill(
        self,
        request: skill_pb2.CreateSkillRequest,
        context: grpc.aio.ServicerContext,
    ) -> skill_pb2.Skill:
        name = (request.name or "").strip()
        if not name:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "name is required")
        async with AsyncSessionLocal() as session:
            skill = await SkillRepository(session).create(
                name        = name,
                description = request.description or "",
                content     = request.content or "",
            )
        log.info("skill_created", skill_id=skill.id, name=skill.name)
        return _to_proto(skill)

    async def UpdateSkill(
        self,
        request: skill_pb2.UpdateSkillRequest,
        context: grpc.aio.ServicerContext,
    ) -> skill_pb2.Skill:
        async with AsyncSessionLocal() as session:
            skill = await SkillRepository(session).update(
                request.id,
                name        = request.name or None,
                description = request.description,
                content     = request.content,
            )
        if skill is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Skill {request.id} not found")
        log.info("skill_updated", skill_id=request.id)
        return _to_proto(skill)

    async def DeleteSkill(
        self,
        request: skill_pb2.DeleteSkillRequest,
        context: grpc.aio.ServicerContext,
    ) -> common_pb2.Empty:
        async with AsyncSessionLocal() as session:
            deleted = await SkillRepository(session).delete(request.id)
        if not deleted:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"Skill {request.id} not found")
        log.info("skill_deleted", skill_id=request.id)
        return common_pb2.Empty()
