"""The single source of "now", so tests can move time without sleeping."""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)
