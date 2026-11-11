import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

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
