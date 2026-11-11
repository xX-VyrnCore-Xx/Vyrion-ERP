import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import Page, clamp_limit, decode_cursor, split_page
from app.models.audit import AuditLog


@dataclass(frozen=True, slots=True)
class AuditContext:
    """Who is acting and from where. ``actor_user_id`` is None for system actions."""

    actor_user_id: uuid.UUID | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    request_id: str | None = None


SYSTEM = AuditContext()


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Field-level changes as ``{field: {"old": ..., "new": ...}}``."""
    return {
        key: {"old": before.get(key), "new": value}
        for key, value in after.items()
        if before.get(key) != value
    }


def record(
    session: AsyncSession,
    context: AuditContext,
    *,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    changes: dict[str, Any] | None = None,
) -> AuditLog:
    """Queue an audit entry in the caller's transaction.

    It commits or rolls back together with the change it describes, so the log can
    never claim something that did not happen.
    """
    entry = AuditLog(
        actor_user_id=context.actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        changes=changes or {},
        ip_address=context.ip_address,
        user_agent=context.user_agent[:400] if context.user_agent else None,
        request_id=context.request_id,
    )
    session.add(entry)
    return entry


async def list_entries(
    session: AsyncSession,
    *,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    action: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> Page[AuditLog]:
    """Newest first. The cursor is the id of the last entry of the previous page; ids are
    time-ordered, so paging stays stable while new entries keep arriving."""
    size = clamp_limit(limit)
    query = select(AuditLog).order_by(AuditLog.id.desc()).limit(size + 1)
    if cursor is not None:
        query = query.where(AuditLog.id < decode_cursor(cursor))
    if entity_type is not None:
        query = query.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.where(AuditLog.entity_id == entity_id)
    if actor_user_id is not None:
        query = query.where(AuditLog.actor_user_id == actor_user_id)
    if action is not None:
        query = query.where(AuditLog.action == action)
    if since is not None:
        query = query.where(AuditLog.occurred_at >= since)
    if until is not None:
        query = query.where(AuditLog.occurred_at < until)
    rows = (await session.execute(query)).scalars().all()
    items, next_cursor = split_page(rows, size)
    return Page(items=items, next_cursor=next_cursor)
