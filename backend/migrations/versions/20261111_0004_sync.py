"""Synchronisation: current records and the append-only change log.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-11 18:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sync_changes",
        sa.Column("seq", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("op_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("entity", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("base_version", sa.Integer(), nullable=False),
        sa.Column("new_version", sa.Integer(), nullable=False),
        sa.Column("fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "applied_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_sync_changes_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("seq", name=op.f("pk_sync_changes")),
        sa.UniqueConstraint("op_id", name=op.f("uq_sync_changes_op_id")),
    )
    op.create_index(
        "ix_sync_changes_record", "sync_changes", ["entity", "entity_id", "new_version"]
    )
    op.create_table(
        "sync_records",
        sa.Column("entity", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("last_seq", sa.BigInteger(), nullable=False),
        sa.Column("last_device_id", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("entity", "entity_id", name=op.f("pk_sync_records")),
    )
    op.create_index("ix_sync_records_last_seq", "sync_records", ["last_seq"])
    # The change log is evidence of who sent what: it can never be rewritten.
    op.execute(
        """
        CREATE TRIGGER sync_changes_no_update_delete
        BEFORE UPDATE OR DELETE ON sync_changes
        FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change()
        """
    )
    op.execute(
        """
        CREATE TRIGGER sync_changes_no_truncate
        BEFORE TRUNCATE ON sync_changes
        FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER sync_changes_no_truncate ON sync_changes")
    op.execute("DROP TRIGGER sync_changes_no_update_delete ON sync_changes")
    op.drop_index("ix_sync_records_last_seq", table_name="sync_records")
    op.drop_table("sync_records")
    op.drop_index("ix_sync_changes_record", table_name="sync_changes")
    op.drop_table("sync_changes")
