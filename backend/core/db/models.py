"""
SQLAlchemy 2 async models — mirror of the SQLite schema in lib/db.ts
mapped to PostgreSQL types.

Design notes:
- Primary keys use Integer (SQLite-compatible autoincrement) with
  BigInteger rendered only on PostgreSQL via with_variant().
- JSON columns use a custom JSONList TypeDecorator: JSONB on Postgres,
  TEXT (JSON-serialized) on SQLite for unit tests.
- Timestamps use DateTime(timezone=True): TIMESTAMPTZ on Postgres,
  DATETIME on SQLite.
"""
import json
from sqlalchemy import (
    BigInteger, Boolean, Column, ForeignKey, Integer,
    Text, func, DateTime, TypeDecorator,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# TIMESTAMP with timezone — TIMESTAMPTZ on Postgres, DATETIME on SQLite
TZ = DateTime(timezone=True)

# Auto-increment PK that works on both SQLite (Integer) and Postgres (BigInteger)
PK = Integer().with_variant(BigInteger, "postgresql")


class JSONList(TypeDecorator):
    """
    Stores a Python list as JSON text on SQLite; uses native JSONB on Postgres.
    Always returns a Python list on read.
    """
    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect):
        if dialect.name == "postgresql":
            return value if value is not None else []
        # SQLite: serialize to JSON string
        if value is None:
            return "[]"
        if isinstance(value, str):
            return value  # already serialized
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return []
        if isinstance(value, list):
            return value  # PostgreSQL JSONB already deserializes
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return []


class Agent(Base):
    __tablename__ = "agents"

    id             = Column(PK, primary_key=True, autoincrement=True)
    name           = Column(Text, nullable=False)
    description    = Column(Text, nullable=False, default="")
    system_prompt  = Column(Text, nullable=False, default="")
    model_override = Column(Text, nullable=True)
    tools          = Column(JSONList, nullable=False, default=list)
    skill_ids      = Column(JSONList, nullable=False, default=list)
    avatar         = Column(Text, nullable=False, default="🤖")
    color          = Column(Text, nullable=False, default="#c15f3c")
    shell_auto     = Column(Boolean, nullable=False, default=False)
    category       = Column(Text, nullable=False, default="")
    working_dir    = Column(Text, nullable=True)
    created_at     = Column(TZ, nullable=False, server_default=func.now())
    updated_at     = Column(TZ, nullable=False, server_default=func.now(),
                            onupdate=func.now())

    knowledge_items = relationship(
        "Knowledge", back_populates="agent",
        cascade="all, delete-orphan", passive_deletes=True,
    )


class Skill(Base):
    __tablename__ = "skills"

    id          = Column(PK, primary_key=True, autoincrement=True)
    name        = Column(Text, nullable=False)
    description = Column(Text, nullable=False, default="")
    content     = Column(Text, nullable=False)
    created_at  = Column(TZ, nullable=False, server_default=func.now())


class Knowledge(Base):
    __tablename__ = "knowledge"

    id         = Column(PK, primary_key=True, autoincrement=True)
    title      = Column(Text, nullable=False)
    content    = Column(Text, nullable=False)
    agent_id   = Column(
        Integer().with_variant(BigInteger, "postgresql"),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_at = Column(TZ, nullable=False, server_default=func.now())

    agent = relationship("Agent", back_populates="knowledge_items")


class AppMeta(Base):
    """Key-value store for app-level config (non-secret)."""
    __tablename__ = "app_meta"

    key   = Column(Text, primary_key=True)
    value = Column(Text, nullable=False)


class TokenUsage(Base):
    __tablename__ = "token_usage"

    id            = Column(PK, primary_key=True, autoincrement=True)
    at            = Column(TZ, nullable=False, server_default=func.now())
    provider      = Column(Text, nullable=False, default="")
    model         = Column(Text, nullable=False, default="")
    source        = Column(Text, nullable=False, default="other")
    input_tokens  = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
