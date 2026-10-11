"""
Agent repository — async SQLAlchemy queries.
All methods accept an AsyncSession injected from the servicer.
"""
from typing import Optional
from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Agent


class AgentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_all(self, page: int = 1, per_page: int = 50) -> tuple[list[Agent], int]:
        offset = (max(page, 1) - 1) * per_page
        total_q = await self._s.execute(select(func.count()).select_from(Agent))
        total: int = total_q.scalar_one()
        rows_q = await self._s.execute(
            select(Agent).order_by(Agent.id).offset(offset).limit(per_page)
        )
        rows = list(rows_q.scalars().all())
        return rows, total

    async def get_by_id(self, agent_id: int) -> Optional[Agent]:
        result = await self._s.execute(select(Agent).where(Agent.id == agent_id))
        return result.scalar_one_or_none()

    async def create(
        self,
        name: str,
        description: str = "",
        system_prompt: str = "",
        model_override: Optional[str] = None,
        tools: Optional[list[str]] = None,
        skill_ids: Optional[list[int]] = None,
        avatar: str = "🤖",
        color: str = "#c15f3c",
        shell_auto: bool = False,
        category: str = "",
    ) -> Agent:
        agent = Agent(
            name=name,
            description=description,
            system_prompt=system_prompt,
            model_override=model_override or None,
            tools=tools or [],
            skill_ids=skill_ids or [],
            avatar=avatar,
            color=color,
            shell_auto=shell_auto,
            category=category,
        )
        self._s.add(agent)
        await self._s.commit()
        await self._s.refresh(agent)
        return agent

    async def update(
        self,
        agent_id: int,
        **fields,
    ) -> Optional[Agent]:
        agent = await self.get_by_id(agent_id)
        if agent is None:
            return None
        for k, v in fields.items():
            if hasattr(agent, k):
                setattr(agent, k, v)
        await self._s.commit()
        await self._s.refresh(agent)
        return agent

    async def delete(self, agent_id: int) -> bool:
        result = await self._s.execute(
            delete(Agent).where(Agent.id == agent_id)
        )
        await self._s.commit()
        return result.rowcount > 0
