"""
conftest.py — shared pytest fixtures for unit tests.
Provides an in-memory SQLite engine + session for fast repo tests.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import StaticPool

import sys
from pathlib import Path

# Add core/ to path so tests can import db, domain, services
sys.path.insert(0, str(Path(__file__).parents[2] / "core"))


@pytest_asyncio.fixture(scope="function")
async def db_session():
    """
    Provides a fresh in-memory SQLite session per test function.
    Uses aiosqlite as the async driver (install: pip install aiosqlite).
    """
    from db.models import Base

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session

    await engine.dispose()
