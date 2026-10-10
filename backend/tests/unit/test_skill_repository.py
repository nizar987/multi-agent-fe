"""
Unit tests for Skill repository.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / "core"))  # backend/core/

from db.models import Base
from domain.skills.repository import SkillRepository


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_skill(session: AsyncSession):
    repo = SkillRepository(session)
    skill = await repo.create(name="SQL Guide", description="SQL tips", content="Use indexes.")
    assert skill.id is not None
    assert skill.name == "SQL Guide"


@pytest.mark.asyncio
async def test_list_skills(session: AsyncSession):
    repo = SkillRepository(session)
    await repo.create(name="Skill A", content="a")
    await repo.create(name="Skill B", content="b")
    skills, total = await repo.list_all()
    assert total == 2


@pytest.mark.asyncio
async def test_update_skill(session: AsyncSession):
    repo = SkillRepository(session)
    skill = await repo.create(name="Old", content="old content")
    updated = await repo.update(skill.id, content="new content")
    assert updated.content == "new content"


@pytest.mark.asyncio
async def test_delete_skill(session: AsyncSession):
    repo = SkillRepository(session)
    skill = await repo.create(name="Gone", content="x")
    assert await repo.delete(skill.id) is True
    assert await repo.get_by_id(skill.id) is None
