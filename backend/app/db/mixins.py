"""Columns shared by domain tables. See docs/DATABASE.md for the conventions."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, Uuid, func
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from app.core.ids import uuid7


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class VersionedMixin:
    """Optimistic locking: every UPDATE checks and increments ``version``.

    A concurrent writer makes SQLAlchemy raise ``StaleDataError`` instead of silently
    overwriting; the same counter is what the sync engine compares.
    """

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:
        # eager_defaults: server-side values (updated_at) are fetched with RETURNING,
        # so reading them after a flush never triggers lazy I/O in async code.
        return {"version_id_col": cls.version, "eager_defaults": True}


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
