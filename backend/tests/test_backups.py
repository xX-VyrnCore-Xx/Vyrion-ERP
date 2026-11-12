"""The backup overview: reads the log written by infra/backup, for administrators only."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app.core import clock
from tests.conftest import Api
from tests.helpers import BASE, bearer, login, make_user

pytestmark = pytest.mark.integration


@pytest.fixture
def backup_dir(tmp_path: Path, api_settings: dict[str, Any]) -> Path:
    api_settings["backup_dir"] = str(tmp_path)
    return tmp_path


def _run(kind: str, ok: bool, finished: datetime, **extra: Any) -> str:
    return json.dumps(
        {
            "kind": kind,
            "ok": ok,
            "file": extra.pop("file", ""),
            "size_bytes": extra.pop("size_bytes", 0),
            "sha256": extra.pop("sha256", ""),
            "started_at": (finished - timedelta(seconds=5)).isoformat(),
            "finished_at": finished.isoformat(),
            "error": extra.pop("error", None),
        }
    )


async def _admin_tokens(api: Api) -> dict[str, Any]:
    await make_user(api, "admin@example.com", roles=["admin"])
    return await login(api, "admin@example.com")


async def test_without_a_backup_service_it_says_so_and_is_stale(backup_dir: Path, api: Api) -> None:
    tokens = await _admin_tokens(api)
    response = await api.client.get(f"{BASE}/backups", headers=bearer(tokens))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configured"] is False
    assert body["stale"] is True
    assert body["last_backup"] is None and body["runs"] == [] and body["files"] == []


async def test_it_reports_the_latest_runs_and_the_files_kept(backup_dir: Path, api: Api) -> None:
    now = clock.utcnow()
    (backup_dir / "daily").mkdir()
    (backup_dir / "daily" / "vyrion-20260101T000000Z.dump.age").write_bytes(b"x" * 10)
    lines = [
        _run("backup", True, now - timedelta(hours=30), file="daily/old.age", size_bytes=5),
        _run("backup", False, now - timedelta(hours=2), error="pg_dump failed"),
        _run("backup", True, now - timedelta(hours=1), file="daily/new.age", size_bytes=10),
        _run("verify", True, now - timedelta(minutes=50)),
        _run("restore_test", True, now - timedelta(minutes=40), file="daily/new.age"),
        "this line is not json",
        '{"kind": "alien"}',
    ]
    (backup_dir / "runs.ndjson").write_text("\n".join(lines), encoding="utf-8")

    tokens = await _admin_tokens(api)
    body = (await api.client.get(f"{BASE}/backups", headers=bearer(tokens))).json()
    assert body["configured"] is True
    assert body["stale"] is False
    assert body["last_backup"]["file"] == "daily/new.age"
    assert body["last_verify"]["ok"] is True
    assert body["last_restore_test"]["ok"] is True
    assert [r["kind"] for r in body["runs"]][:2] == ["restore_test", "verify"]  # newest first
    assert len(body["runs"]) == 5  # the two broken lines are skipped
    assert [f["name"] for f in body["files"]] == ["vyrion-20260101T000000Z.dump.age"]
    assert body["files"][0]["tier"] == "daily" and body["files"][0]["size_bytes"] == 10


async def test_a_failed_latest_backup_is_visible_and_old_success_goes_stale(
    backup_dir: Path, api: Api
) -> None:
    now = clock.utcnow().astimezone(UTC)
    lines = [
        _run("backup", True, now - timedelta(hours=60)),
        _run("backup", False, now - timedelta(hours=1), error="disk full"),
    ]
    (backup_dir / "runs.ndjson").write_text("\n".join(lines), encoding="utf-8")
    tokens = await _admin_tokens(api)
    body = (await api.client.get(f"{BASE}/backups", headers=bearer(tokens))).json()
    assert body["last_backup"]["ok"] is False and body["last_backup"]["error"] == "disk full"
    assert body["stale"] is True


async def test_only_administrators_can_see_it(backup_dir: Path, api: Api) -> None:
    await make_user(api, "staff@example.com", roles=["employee"])
    tokens = await login(api, "staff@example.com")
    response = await api.client.get(f"{BASE}/backups", headers=bearer(tokens))
    assert response.status_code == 403
    assert (await api.client.get(f"{BASE}/backups")).status_code == 401
