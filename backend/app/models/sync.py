import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SyncRecord(Base):
    """Current state of one synchronised record (any entity the desktop apps define).

    The server does not know the entities' columns: it stores each record as JSON and
    enforces versions, ordering and conflicts. The app validates the data itself.
    """

    __tablename__ = "sync_records"
    __table_args__ = (Index("ix_sync_records_last_seq", "last_seq"),)

    entity: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # The device whose change is the latest state. None after a merge: the result matches
    # nobody's local copy, so every device (including the sender) must download it.
    last_device_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)


class SyncChange(Base):
    """Append-only log of applied operations (a trigger rejects UPDATE and DELETE).

    ``op_id`` is the idempotency key chosen by the client: sending the same operation
    twice returns the original outcome instead of applying it again.
    """

    __tablename__ = "sync_changes"
    __table_args__ = (Index("ix_sync_changes_record", "entity", "entity_id", "new_version"),)

    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    op_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False)
    device_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    entity: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    base_version: Mapped[int] = mapped_column(Integer, nullable=False)
    new_version: Mapped[int] = mapped_column(Integer, nullable=False)
    fields: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
