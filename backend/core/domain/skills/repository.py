"""
Skill repository — async SQLAlchemy queries.
"""
from typing import Optional
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Skill


class SkillRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_all(self, page: int = 1, per_page: int = 50) -> tuple[list[Skill], int]:
        offset = (max(page, 1) - 1) * per_page
        total_q = await self._s.execute(select(func.count()).select_from(Skill))
        total: int = total_q.scalar_one()
        rows_q = await self._s.execute(
            select(Skill).order_by(Skill.id).offset(offset).limit(per_page)
        )
        return list(rows_q.scalars().all()), total

    async def get_by_id(self, skill_id: int) -> Optional[Skill]:
        result = await self._s.execute(select(Skill).where(Skill.id == skill_id))
        return result.scalar_one_or_none()

    async def create(self, name: str, description: str = "", content: str = "") -> Skill:
        skill = Skill(name=name, description=description, content=content)
        self._s.add(skill)
        await self._s.commit()
        await self._s.refresh(skill)
        return skill

    async def update(self, skill_id: int, **fields) -> Optional[Skill]:
        skill = await self.get_by_id(skill_id)
        if skill is None:
            return None
        for k, v in fields.items():
            if hasattr(skill, k):
                setattr(skill, k, v)
        await self._s.commit()
        await self._s.refresh(skill)
        return skill

    async def delete(self, skill_id: int) -> bool:
        result = await self._s.execute(delete(Skill).where(Skill.id == skill_id))
        await self._s.commit()
        return result.rowcount > 0
