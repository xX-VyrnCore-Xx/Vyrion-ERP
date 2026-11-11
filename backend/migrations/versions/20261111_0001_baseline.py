"""Baseline: empty schema, establishes the migration chain.

Revision ID: 0001
Revises:
Create Date: 2026-11-11
"""

from collections.abc import Sequence

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Domain tables are introduced from milestone 3 onwards."""


def downgrade() -> None:
    """Nothing to revert."""
