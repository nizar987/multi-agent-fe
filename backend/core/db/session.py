"""
Async SQLAlchemy session factory + DB init helper.
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
import structlog

from app.settings import settings
from db.models import Base

log = structlog.get_logger(__name__)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def init_db() -> None:
    """Create all tables if they don't exist (dev convenience).
    In production, use Alembic migrations instead."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    log.info("db_tables_ensured")


async def get_session() -> AsyncSession:  # type: ignore[return]
    """Dependency / context manager for a single request session."""
    async with AsyncSessionLocal() as session:
        yield session
