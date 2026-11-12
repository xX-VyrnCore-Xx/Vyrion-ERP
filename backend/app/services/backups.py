"""Reads the run log and the files written by the backup service (infra/backup).

The server never touches the backups themselves: the volume is mounted read-only, so a
compromised API cannot alter or delete them.
"""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pydantic import ValidationError

from app.core import clock
from app.schemas.backups import BackupFile, BackupOverview, BackupRun

STALE_AFTER_HOURS = 36  # a daily job plus slack for a late run
MAX_RUNS = 100
TIERS = ("daily", "weekly", "monthly")


def _read_runs(directory: Path) -> list[BackupRun]:
    log = directory / "runs.ndjson"
    if not log.is_file():
        return []
    runs: list[BackupRun] = []
    # Only the tail matters; the log is small (a few lines a day) but never trusted blindly.
    for line in log.read_text(encoding="utf-8", errors="replace").splitlines()[-1000:]:
        try:
            runs.append(BackupRun.model_validate(json.loads(line)))
        except (ValueError, ValidationError):
            continue  # a torn or foreign line must not hide the rest
    return runs


def _read_files(directory: Path) -> list[BackupFile]:
    files: list[BackupFile] = []
    for tier in TIERS:
        for path in (directory / tier).glob("vyrion-*.dump.age"):
            stat = path.stat()
            files.append(
                BackupFile(
                    name=path.name,
                    tier=tier,
                    size_bytes=stat.st_size,
                    modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                )
            )
    return sorted(files, key=lambda f: f.modified_at, reverse=True)


def _overview(directory: Path, now: datetime) -> BackupOverview:
    runs = _read_runs(directory)
    files = _read_files(directory)

    def last(kind: str, *, ok: bool | None = None) -> BackupRun | None:
        for run in reversed(runs):
            if run.kind == kind and (ok is None or run.ok == ok):
                return run
        return None

    good = last("backup", ok=True)
    stale = good is None or now - good.finished_at > timedelta(hours=STALE_AFTER_HOURS)
    return BackupOverview(
        configured=bool(runs or files),
        last_backup=last("backup"),
        last_verify=last("verify"),
        last_restore_test=last("restore_test"),
        stale=stale,
        stale_after_hours=STALE_AFTER_HOURS,
        runs=list(reversed(runs))[:MAX_RUNS],
        files=files,
    )


async def overview(directory: str) -> BackupOverview:
    return await asyncio.to_thread(_overview, Path(directory), clock.utcnow())
