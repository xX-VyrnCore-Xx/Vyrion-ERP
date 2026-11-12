from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class BackupRun(BaseModel):
    kind: Literal["backup", "verify", "restore_test"]
    ok: bool
    file: str
    size_bytes: int
    sha256: str
    started_at: datetime
    finished_at: datetime
    error: str | None


class BackupFile(BaseModel):
    name: str
    tier: Literal["daily", "weekly", "monthly"]
    size_bytes: int
    modified_at: datetime


class BackupOverview(BaseModel):
    """What the backup service reported; ``configured`` is false when it never wrote anything."""

    configured: bool
    last_backup: BackupRun | None
    last_verify: BackupRun | None
    last_restore_test: BackupRun | None
    # True when the newest successful backup is older than ``stale_after_hours``.
    stale: bool
    stale_after_hours: int
    runs: list[BackupRun]
    files: list[BackupFile]
