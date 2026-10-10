"""
Knowledge repository — async SQLAlchemy queries.
"""
from typing import Optional
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models import Knowledge, Agent


class KnowledgeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_all(
        self,
        agent_id: Optional[int] = None,
        page: int = 1,
        per_page: int = 50,
    ) -> tuple[list[Knowledge], int]:
        offset = (max(page, 1) - 1) * per_page
        base = select(Knowledge).options(selectinload(Knowledge.agent))
        if agent_id:
            base = base.where(Knowledge.agent_id == agent_id)

        total_q = await self._s.execute(
            select(func.count()).select_from(
                base.subquery()
            )
        )
        total: int = total_q.scalar_one()

        rows_q = await self._s.execute(
            base.order_by(Knowledge.id.desc()).offset(offset).limit(per_page)
        )
        return list(rows_q.scalars().all()), total

    async def get_by_id(self, item_id: int) -> Optional[Knowledge]:
        result = await self._s.execute(
            select(Knowledge)
            .options(selectinload(Knowledge.agent))
            .where(Knowledge.id == item_id)
        )
        return result.scalar_one_or_none()

    async def create(
        self,
        title: str,
        content: str,
        agent_id: Optional[int] = None,
    ) -> Knowledge:
        item = Knowledge(title=title, content=content, agent_id=agent_id or None)
        self._s.add(item)
        await self._s.commit()
        await self._s.refresh(item, ["agent"])
        return item

    async def delete(self, item_id: int) -> bool:
        result = await self._s.execute(delete(Knowledge).where(Knowledge.id == item_id))
        await self._s.commit()
        return result.rowcount > 0
