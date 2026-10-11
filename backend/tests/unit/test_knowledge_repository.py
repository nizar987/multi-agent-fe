"""
Unit tests for Knowledge repository.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / "core"))  # backend/core/

from db.models import Base
from domain.knowledge.repository import KnowledgeRepository


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
async def test_create_knowledge(session: AsyncSession):
    repo = KnowledgeRepository(session)
    item = await repo.create(title="DB Tips", content="Use connection pooling.")
    assert item.id is not None
    assert item.title == "DB Tips"
    assert item.agent_id is None  # global knowledge


@pytest.mark.asyncio
async def test_list_knowledge(session: AsyncSession):
    repo = KnowledgeRepository(session)
    await repo.create(title="Item A", content="a")
    await repo.create(title="Item B", content="b")
    items, total = await repo.list_all()
    assert total == 2


@pytest.mark.asyncio
async def test_delete_knowledge(session: AsyncSession):
    repo = KnowledgeRepository(session)
    item = await repo.create(title="To Delete", content="x")
    assert await repo.delete(item.id) is True
    assert await repo.get_by_id(item.id) is None
