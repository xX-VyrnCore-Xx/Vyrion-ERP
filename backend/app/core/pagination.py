"""Keyset (cursor) pagination over UUIDv7 primary keys.

Identifiers are time-ordered, so ``WHERE id > :cursor ORDER BY id`` yields a stable
listing that does not skip or repeat rows when data changes between pages.
"""

import base64
import binascii
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.core.errors import InvalidInputError

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class HasId(Protocol):
    @property
    def id(self) -> uuid.UUID: ...


@dataclass(frozen=True, slots=True)
class Page[T]:
    """One page of results; the API layer maps the items to response schemas."""

    items: list[T]
    next_cursor: str | None


def encode_cursor(value: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(value.bytes).rstrip(b"=").decode()


def decode_cursor(cursor: str) -> uuid.UUID:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        return uuid.UUID(bytes=raw)
    except (ValueError, binascii.Error) as exc:
        raise InvalidInputError("Invalid pagination cursor") from exc


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    if limit < 1:
        raise InvalidInputError("limit must be at least 1")
    return min(limit, MAX_LIMIT)


def split_page[R: HasId](rows: Sequence[R], limit: int) -> tuple[list[R], str | None]:
    """Turn ``limit + 1`` fetched rows into one page and the cursor for the next."""
    if len(rows) <= limit:
        return list(rows), None
    page = list(rows[:limit])
    return page, encode_cursor(page[-1].id)
