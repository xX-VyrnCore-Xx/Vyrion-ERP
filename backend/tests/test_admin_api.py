from typing import Any

import pytest
from sqlalchemy import select

from app.models import AuditLog
from tests.conftest import Api
from tests.helpers import (
    BASE,
    PASSWORD,
    bearer,
    error_code,
    fresh_user,
    login,
    make_user,
    post_login,
)
from tests.test_authorization import COMPANY

pytestmark = pytest.mark.integration


async def as_boss(api: Api) -> dict[str, Any]:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    return await login(api, "boss@example.com")


# --- users ------------------------------------------------------------------------------


async def test_user_lifecycle_with_optimistic_locking(api: Api) -> None:
    boss = await as_boss(api)
    created = await api.client.post(
        f"{BASE}/users",
        headers=bearer(boss),
        json={"email": "New@Example.com", "full_name": " Nina "},
    )
    assert created.status_code == 201
    user = created.json()["user"]
    assert (user["email"], user["full_name"], user["version"]) == ("new@example.com", "Nina", 1)

    got = await api.client.get(f"{BASE}/users/{user['id']}", headers=bearer(boss))
    assert got.json()["id"] == user["id"]

    patched = await api.client.patch(
        f"{BASE}/users/{user['id']}",
        headers=bearer(boss),
        json={"full_name": "Nina B.", "version": 1},
    )
    assert patched.status_code == 200
    assert (patched.json()["full_name"], patched.json()["version"]) == ("Nina B.", 2)

    stale = await api.client.patch(
        f"{BASE}/users/{user['id']}", headers=bearer(boss), json={"full_name": "Late", "version": 1}
    )
    assert stale.status_code == 409
    assert error_code(stale) == "version_conflict"
    assert stale.json()["error"]["details"] == {"expected_version": 1, "current_version": 2}

    deleted = await api.client.delete(f"{BASE}/users/{user['id']}?version=2", headers=bearer(boss))
    assert deleted.status_code == 204
    gone = await api.client.get(f"{BASE}/users/{user['id']}", headers=bearer(boss))
    assert gone.status_code == 404


async def test_duplicate_and_invalid_emails_are_rejected(api: Api) -> None:
    boss = await as_boss(api)
    payload = {"email": "dup@example.com", "full_name": "Dup"}
    assert (
        await api.client.post(f"{BASE}/users", headers=bearer(boss), json=payload)
    ).status_code == 201
    again = await api.client.post(f"{BASE}/users", headers=bearer(boss), json=payload)
    assert (again.status_code, error_code(again)) == (409, "conflict")
    bad = await api.client.post(
        f"{BASE}/users", headers=bearer(boss), json={"email": "nope", "full_name": "X"}
    )
    assert bad.status_code == 422


async def test_the_user_list_is_paginated_and_never_shows_credentials(api: Api) -> None:
    boss = await as_boss(api)
    for index in range(3):
        await make_user(api, f"user{index}@example.com")
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        url = f"{BASE}/users?limit=2" + (f"&cursor={cursor}" if cursor else "")
        response = await api.client.get(url, headers=bearer(boss))
        body = response.json()
        seen += [item["email"] for item in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        for forbidden in ("password", "totp_secret", "token"):
            assert forbidden not in response.text.replace("has_password", "")
        if cursor is None:
            break
    assert pages == 2
    assert sorted(seen) == sorted(
        ["boss@example.com", "user0@example.com", "user1@example.com", "user2@example.com"]
    )
    bad = await api.client.get(f"{BASE}/users?limit=0", headers=bearer(boss))
    assert bad.status_code == 422


async def test_deactivating_a_user_disconnects_them_and_blocks_login(api: Api) -> None:
    boss = await as_boss(api)
    await make_user(api, "ada@example.com")
    ada = await login(api, "ada@example.com")
    ident, version = (await fresh_user(api, "ada@example.com")).id, 1

    response = await api.client.patch(
        f"{BASE}/users/{ident}", headers=bearer(boss), json={"is_active": False, "version": version}
    )
    assert response.status_code == 200
    assert (await api.client.get(f"{BASE}/auth/me", headers=bearer(ada))).status_code == 401
    assert (await post_login(api, "ada@example.com")).status_code == 401


async def test_deleting_a_user_frees_the_address_and_ends_their_sessions(api: Api) -> None:
    boss = await as_boss(api)
    await make_user(api, "ada@example.com")
    ada = await login(api, "ada@example.com")
    ident = (await fresh_user(api, "ada@example.com")).id
    await api.client.delete(f"{BASE}/users/{ident}?version=1", headers=bearer(boss))
    assert (await api.client.get(f"{BASE}/auth/me", headers=bearer(ada))).status_code == 401
    again = await api.client.post(
        f"{BASE}/users",
        headers=bearer(boss),
        json={"email": "ada@example.com", "full_name": "Ada 2"},
    )
    assert again.status_code == 201


async def test_roles_can_be_assigned_and_reducing_them_disconnects_the_user(api: Api) -> None:
    boss = await as_boss(api)
    await make_user(api, "ada@example.com", roles=["manager"])
    ada = await login(api, "ada@example.com")
    ident = (await fresh_user(api, "ada@example.com")).id

    unknown = await api.client.put(
        f"{BASE}/users/{ident}/roles",
        headers=bearer(boss),
        json={"roles": ["wizard"], "version": 1},
    )
    assert (unknown.status_code, unknown.json()["error"]["details"]) == (422, {"roles": ["wizard"]})

    stale = await api.client.put(
        f"{BASE}/users/{ident}/roles",
        headers=bearer(boss),
        json={"roles": ["employee"], "version": 9},
    )
    assert stale.status_code == 409

    reduced = await api.client.put(
        f"{BASE}/users/{ident}/roles",
        headers=bearer(boss),
        json={"roles": ["employee"], "version": 1},
    )
    assert reduced.status_code == 200
    assert [role["key"] for role in reduced.json()["roles"]] == ["employee"]
    # Losing privileges ends the sessions that were opened with the old ones.
    assert (await api.client.get(f"{BASE}/auth/me", headers=bearer(ada))).status_code == 401


async def test_revoking_sessions_disconnects_a_user_from_every_device(api: Api) -> None:
    boss = await as_boss(api)
    await make_user(api, "ada@example.com")
    laptop, phone = await login(api, "ada@example.com"), await login(api, "ada@example.com")
    ident = (await fresh_user(api, "ada@example.com")).id
    response = await api.client.post(f"{BASE}/users/{ident}/revoke-sessions", headers=bearer(boss))
    assert response.json() == {"sessions_revoked": 2}
    for tokens in (laptop, phone):
        assert (await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))).status_code == 401
    # The user can sign in again: this is a disconnect, not a ban.
    assert (await post_login(api, "ada@example.com")).status_code == 200


# --- roles ------------------------------------------------------------------------------


async def test_roles_and_the_permission_catalog(api: Api) -> None:
    boss = await as_boss(api)
    listing = await api.client.get(f"{BASE}/roles", headers=bearer(boss))
    keys = [role["key"] for role in listing.json()]
    assert keys == ["admin", "collaborator", "employee", "manager", "super_admin"]
    assert all(role["is_system"] for role in listing.json())

    catalog = await api.client.get(f"{BASE}/roles/permissions", headers=bearer(boss))
    assert "core.users:admin" in {item["key"] for item in catalog.json()}


async def test_custom_role_lifecycle(api: Api) -> None:
    boss = await as_boss(api)
    created = await api.client.post(
        f"{BASE}/roles",
        headers=bearer(boss),
        json={"key": "hr_viewer", "name": "HR", "permissions": ["core.users:view"]},
    )
    assert created.status_code == 201
    role = created.json()
    assert [p["key"] for p in role["permissions"]] == ["core.users:view"]
    assert role["is_system"] is False

    changed = await api.client.put(
        f"{BASE}/roles/{role['id']}/permissions",
        headers=bearer(boss),
        json={"permissions": ["core.users:view", "core.users:export"], "version": 1},
    )
    assert changed.status_code == 200 and changed.json()["version"] == 2

    await make_user(api, "ada@example.com")
    ident = (await fresh_user(api, "ada@example.com")).id
    await api.client.put(
        f"{BASE}/users/{ident}/roles",
        headers=bearer(boss),
        json={"roles": ["hr_viewer"], "version": 1},
    )
    in_use = await api.client.delete(f"{BASE}/roles/{role['id']}?version=2", headers=bearer(boss))
    assert in_use.status_code == 409  # still assigned

    for_ada = await login(api, "ada@example.com")
    assert (await api.client.get(f"{BASE}/users", headers=bearer(for_ada))).status_code == 200


async def test_a_role_key_cannot_shadow_a_system_role(api: Api) -> None:
    boss = await as_boss(api)
    response = await api.client.post(
        f"{BASE}/roles", headers=bearer(boss), json={"key": "admin", "name": "Fake"}
    )
    assert response.status_code == 409


# --- company ----------------------------------------------------------------------------


async def test_company_is_created_then_updated_with_a_version(api: Api) -> None:
    boss = await as_boss(api)
    missing = await api.client.get(f"{BASE}/company", headers=bearer(boss))
    assert missing.status_code == 404

    created = await api.client.put(f"{BASE}/company", headers=bearer(boss), json=COMPANY)
    assert created.status_code == 200
    assert (created.json()["version"], created.json()["fatturapa_regime_code"]) == (1, "RF01")

    no_version = await api.client.put(f"{BASE}/company", headers=bearer(boss), json=COMPANY)
    assert no_version.status_code == 409  # already exists: say which version you edit

    updated = await api.client.put(
        f"{BASE}/company", headers=bearer(boss), json={**COMPANY, "city": "Milano", "version": 1}
    )
    assert (updated.status_code, updated.json()["city"]) == (200, "Milano")
    stale = await api.client.put(
        f"{BASE}/company", headers=bearer(boss), json={**COMPANY, "city": "Torino", "version": 1}
    )
    assert stale.status_code == 409


@pytest.mark.parametrize(
    "override",
    [
        {"tax_regime": "forfettario"},  # a company cannot use the flat-rate regime
        {"vat_number": "12345678901"},
        {"legal_form": "plc"},
        {"surprise": "field"},
    ],
)
async def test_invalid_company_data_is_rejected(api: Api, override: dict[str, Any]) -> None:
    boss = await as_boss(api)
    response = await api.client.put(
        f"{BASE}/company", headers=bearer(boss), json={**COMPANY, **override}
    )
    assert response.status_code == 422


# --- audit trail ------------------------------------------------------------------------


async def test_administrative_actions_are_audited_with_who_where_and_request(api: Api) -> None:
    boss = await as_boss(api)
    boss_row = await fresh_user(api, "boss@example.com")
    await api.client.post(
        f"{BASE}/users",
        headers={**bearer(boss), "X-Request-ID": "req-abc-123", "User-Agent": "Vyrion-Test/1.0"},
        json={"email": "new@example.com", "full_name": "New"},
    )
    entry = (
        await api.session.execute(select(AuditLog).where(AuditLog.action == "user.create"))
    ).scalar_one()
    assert entry.actor_user_id == boss_row.id
    assert entry.request_id == "req-abc-123"
    assert entry.user_agent == "Vyrion-Test/1.0"
    assert str(entry.ip_address) == "127.0.0.1"
    assert entry.changes["email"] == {"old": None, "new": "new@example.com"}
    assert "password" not in str(entry.changes)  # no secret ever lands in the trail


async def test_the_audit_log_can_be_filtered_and_paged(api: Api) -> None:
    boss = await as_boss(api)
    for index in range(3):
        await api.client.post(
            f"{BASE}/users",
            headers=bearer(boss),
            json={"email": f"u{index}@example.com", "full_name": "U"},
        )
    await api.client.put(f"{BASE}/company", headers=bearer(boss), json=COMPANY)

    only_users = await api.client.get(
        f"{BASE}/audit-log?entity_type=user&action=user.create", headers=bearer(boss)
    )
    assert len(only_users.json()["items"]) == 3
    assert {item["action"] for item in only_users.json()["items"]} == {"user.create"}

    first = await api.client.get(f"{BASE}/audit-log?limit=2", headers=bearer(boss))
    page1 = first.json()
    assert len(page1["items"]) == 2 and page1["next_cursor"]
    second = await api.client.get(
        f"{BASE}/audit-log?limit=2&cursor={page1['next_cursor']}", headers=bearer(boss)
    )
    ids = [item["id"] for item in page1["items"] + second.json()["items"]]
    assert len(ids) == len(set(ids))  # no repeats across pages
    assert ids == sorted(ids, reverse=True)  # newest first

    boss_id = str((await fresh_user(api, "boss@example.com")).id)
    mine = await api.client.get(f"{BASE}/audit-log?actor_user_id={boss_id}", headers=bearer(boss))
    assert mine.json()["items"] and all(i["actor_user_id"] == boss_id for i in mine.json()["items"])
    future = await api.client.get(
        f"{BASE}/audit-log?since=2999-01-01T00:00:00Z", headers=bearer(boss)
    )
    assert future.json()["items"] == []


async def test_there_is_no_way_to_alter_the_audit_log_through_the_api(api: Api) -> None:
    boss = await as_boss(api)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        response = await api.client.request(
            method, f"{BASE}/audit-log", headers=bearer(boss), json={}
        )
        assert response.status_code == 405


async def test_a_password_is_never_logged_in_the_trail(api: Api) -> None:
    boss = await as_boss(api)
    new = await api.client.post(
        f"{BASE}/users", headers=bearer(boss), json={"email": "n@example.com", "full_name": "N"}
    )
    token = new.json()["setup_token"]
    await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": token, "new_password": PASSWORD + "-zzz"}
    )
    rows = (await api.session.execute(select(AuditLog.changes))).scalars().all()
    dump = str(rows)
    assert PASSWORD not in dump and token not in dump
