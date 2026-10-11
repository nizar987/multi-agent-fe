"""Initial schema — agents, skills, knowledge, app_meta, token_usage

Revision ID: 0001
Revises:
Create Date: 2026-07-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMPTZ

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id",             sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("name",           sa.Text(),       nullable=False),
        sa.Column("description",    sa.Text(),       nullable=False, server_default=""),
        sa.Column("system_prompt",  sa.Text(),       nullable=False, server_default=""),
        sa.Column("model_override", sa.Text(),       nullable=True),
        sa.Column("tools",          JSONB(),         nullable=False, server_default="[]"),
        sa.Column("skill_ids",      JSONB(),         nullable=False, server_default="[]"),
        sa.Column("avatar",         sa.Text(),       nullable=False, server_default="🤖"),
        sa.Column("color",          sa.Text(),       nullable=False, server_default="#c15f3c"),
        sa.Column("shell_auto",     sa.Boolean(),    nullable=False, server_default="false"),
        sa.Column("category",       sa.Text(),       nullable=False, server_default=""),
        sa.Column("working_dir",    sa.Text(),       nullable=True),
        sa.Column("created_at",     TIMESTAMPTZ(),   nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at",     TIMESTAMPTZ(),   nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "skills",
        sa.Column("id",          sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("name",        sa.Text(),       nullable=False),
        sa.Column("description", sa.Text(),       nullable=False, server_default=""),
        sa.Column("content",     sa.Text(),       nullable=False),
        sa.Column("created_at",  TIMESTAMPTZ(),   nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "knowledge",
        sa.Column("id",         sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("title",      sa.Text(),       nullable=False),
        sa.Column("content",    sa.Text(),       nullable=False),
        sa.Column("agent_id",   sa.BigInteger(), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", TIMESTAMPTZ(),   nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "app_meta",
        sa.Column("key",   sa.Text(), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
    )

    op.create_table(
        "token_usage",
        sa.Column("id",            sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("at",            TIMESTAMPTZ(),   nullable=False, server_default=sa.text("now()")),
        sa.Column("provider",      sa.Text(),       nullable=False, server_default=""),
        sa.Column("model",         sa.Text(),       nullable=False, server_default=""),
        sa.Column("source",        sa.Text(),       nullable=False, server_default="other"),
        sa.Column("input_tokens",  sa.Integer(),    nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(),    nullable=False, server_default="0"),
    )

    # Indexes
    op.create_index("idx_knowledge_agent_id", "knowledge", ["agent_id"])
    op.create_index("idx_token_usage_at",     "token_usage", ["at"])


def downgrade() -> None:
    op.drop_index("idx_token_usage_at",     table_name="token_usage")
    op.drop_index("idx_knowledge_agent_id", table_name="knowledge")
    op.drop_table("token_usage")
    op.drop_table("app_meta")
    op.drop_table("knowledge")
    op.drop_table("skills")
    op.drop_table("agents")
