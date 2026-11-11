"""Helpers shared by the service layer."""

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from app.core.errors import VersionConflictError


class Versioned(Protocol):
    version: int


def ensure_version(entity: Versioned, expected_version: int) -> None:
    """Reject a write based on an outdated copy of the record."""
    if entity.version != expected_version:
        raise VersionConflictError(
            "The record was modified by someone else",
            details={"expected_version": expected_version, "current_version": entity.version},
        )


async def flush_versioned(session: AsyncSession) -> None:
    """Flush, turning a lost optimistic-lock race into a version conflict."""
    try:
        await session.flush()
    except StaleDataError as exc:
        raise VersionConflictError("The record was modified by someone else") from exc
