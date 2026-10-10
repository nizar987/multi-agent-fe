"""
Unit tests for Agent repository.
Uses an in-memory SQLite database via SQLAlchemy (sync) for speed.
These tests verify repository logic without needing a live Postgres instance.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / "core"))  # backend/core/

from db.models import Base
from domain.agents.repository import AgentRepository


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
async def test_create_agent(session: AsyncSession):
    repo = AgentRepository(session)
    agent = await repo.create(name="Test Agent", description="desc", tools=["memory"])
    assert agent.id is not None
    assert agent.name == "Test Agent"
    assert agent.tools == ["memory"]


@pytest.mark.asyncio
async def test_list_agents(session: AsyncSession):
    repo = AgentRepository(session)
    await repo.create(name="Agent A")
    await repo.create(name="Agent B")
    agents, total = await repo.list_all()
    assert total == 2
    assert len(agents) == 2


@pytest.mark.asyncio
async def test_get_agent_not_found(session: AsyncSession):
    repo = AgentRepository(session)
    result = await repo.get_by_id(9999)
    assert result is None


@pytest.mark.asyncio
async def test_update_agent(session: AsyncSession):
    repo = AgentRepository(session)
    agent = await repo.create(name="Old Name")
    updated = await repo.update(agent.id, name="New Name", category="coding")
    assert updated is not None
    assert updated.name == "New Name"
    assert updated.category == "coding"


@pytest.mark.asyncio
async def test_delete_agent(session: AsyncSession):
    repo = AgentRepository(session)
    agent = await repo.create(name="To Delete")
    deleted = await repo.delete(agent.id)
    assert deleted is True
    result = await repo.get_by_id(agent.id)
    assert result is None


@pytest.mark.asyncio
async def test_delete_nonexistent_agent(session: AsyncSession):
    repo = AgentRepository(session)
    deleted = await repo.delete(9999)
    assert deleted is False
