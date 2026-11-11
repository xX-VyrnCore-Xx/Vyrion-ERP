"""Server-side RBAC: every route needs exactly its permission, grants take effect at once,
and nobody can hand out more than they hold."""

from typing import Any

import pytest
from sqlalchemy import select

from app.core.errors import ForbiddenError
from app.core.permissions import CATALOG_KEYS
from app.models import Role
from app.services.authz import ensure_not_last_super_admin
from tests.conftest import Api
from tests.helpers import BASE, bearer, error_code, login, make_user

pytestmark = pytest.mark.integration

COMPANY: dict[str, Any] = {
    "legal_name": "VyrnCore Enterprises S.r.l.",
    "legal_form": "srl",
    "tax_regime": "ordinario",
    "vat_number": "12345678903",
    "fiscal_code": "12345678903",
    "street": "Via Roma 1",
    "postal_code": "00100",
    "city": "Roma",
    "province": "RM",
}

# (method, path, JSON body, the one permission that opens it)
ROUTES: list[tuple[str, str, dict[str, Any] | None, str]] = [
    ("GET", "/users", None, "core.users:view"),
    ("POST", "/users", {"email": "new@example.com", "full_name": "New"}, "core.users:create"),
    ("GET", "/roles", None, "core.roles:view"),
    ("GET", "/roles/permissions", None, "core.roles:view"),
    ("POST", "/roles", {"key": "extra_role", "name": "Extra"}, "core.roles:create"),
    ("GET", "/company", None, "core.company:view"),
    ("PUT", "/company", COMPANY, "core.company:update"),
    ("GET", "/audit-log", None, "core.audit_log:view"),
]


async def call(api: Api, method: str, path: str, body: Any, tokens: dict[str, Any] | None):  # type: ignore[no-untyped-def]
    headers = bearer(tokens) if tokens else {}
    return await api.client.request(method, f"{BASE}{path}", json=body, headers=headers)


@pytest.mark.parametrize(("method", "path", "body", "needed"), ROUTES)
async def test_every_route_needs_a_token(
    api: Api, method: str, path: str, body: Any, needed: str
) -> None:
    response = await call(api, method, path, body, None)
    assert response.status_code == 401
    assert error_code(response) == "unauthenticated"


@pytest.mark.parametrize(("method", "path", "body", "needed"), ROUTES)
async def test_every_route_needs_exactly_its_permission(
    api: Api, method: str, path: str, body: Any, needed: str
) -> None:
    # Holding every permission *except* the required one is not enough...
    await make_user(api, "almost@example.com", permissions=CATALOG_KEYS - {needed})
    almost = await login(api, "almost@example.com")
    denied = await call(api, method, path, body, almost)
    assert denied.status_code == 403
    assert error_code(denied) == "forbidden"
    assert needed not in denied.text  # the reply does not reveal what would have worked

    # ...while that one permission alone, granted directly to the user, is.
    await make_user(api, "exact@example.com", permissions={needed})
    exact = await login(api, "exact@example.com")
    allowed = await call(api, method, path, body, exact)
    assert allowed.status_code not in (401, 403), allowed.text


async def test_system_roles_map_to_what_they_should_allow(api: Api) -> None:
    # /company answers 404 when permitted: the company is not configured yet in this test.
    expectations = {
        "employee": {"/company": 404, "/users": 403, "/roles": 403, "/audit-log": 403},
        "manager": {"/company": 404, "/users": 200, "/roles": 200, "/audit-log": 403},
        "collaborator": {"/company": 403, "/users": 403, "/roles": 403, "/audit-log": 403},
        "admin": {"/company": 404, "/users": 200, "/roles": 200, "/audit-log": 200},
    }
    for role, paths in expectations.items():
        await make_user(api, f"{role}@example.com", roles=[role])
        tokens = await login(api, f"{role}@example.com")
        for path, expected in paths.items():
            response = await call(api, "GET", path, None, tokens)
            assert response.status_code == expected, (role, path, response.text)


async def test_a_manager_can_look_but_not_touch(api: Api) -> None:
    await make_user(api, "mgr@example.com", roles=["manager"])
    tokens = await login(api, "mgr@example.com")
    assert (await call(api, "GET", "/users", None, tokens)).status_code == 200
    create = await call(api, "POST", "/users", {"email": "x@example.com", "full_name": "X"}, tokens)
    assert create.status_code == 403
    assert (await call(api, "PUT", "/company", COMPANY, tokens)).status_code == 403


async def test_permission_changes_apply_to_the_next_request_without_a_new_login(api: Api) -> None:
    user = await make_user(api, "ada@example.com", roles=["manager"])
    tokens = await login(api, "ada@example.com")
    assert (await call(api, "GET", "/users", None, tokens)).status_code == 200

    user.roles = []  # an administrator removes the role
    await api.session.commit()
    assert (await call(api, "GET", "/users", None, tokens)).status_code == 403


async def test_a_deactivated_account_keeps_no_permissions(api: Api) -> None:
    user = await make_user(api, "ada@example.com", roles=["admin"])
    tokens = await login(api, "ada@example.com")
    user.is_active = False
    await api.session.commit()
    assert (await call(api, "GET", "/users", None, tokens)).status_code == 401


# --- nobody can hand out more than they hold ---------------------------------------------


async def user_id(api: Api, email: str) -> tuple[str, int]:
    from tests.helpers import fresh_user

    user = await fresh_user(api, email)
    return str(user.id), user.version


async def put_roles(api: Api, tokens: dict[str, Any], email: str, roles: list[str]):  # type: ignore[no-untyped-def]
    ident, version = await user_id(api, email)
    return await api.client.put(
        f"{BASE}/users/{ident}/roles",
        headers=bearer(tokens),
        json={"roles": roles, "version": version},
    )


@pytest.mark.parametrize("protected", ["admin", "super_admin"])
async def test_only_the_main_administrator_hands_out_administrator_roles(
    api: Api, protected: str
) -> None:
    await make_user(api, "admin@example.com", roles=["admin"])
    await make_user(api, "boss@example.com", roles=["super_admin"])
    await make_user(api, "target@example.com")
    admin = await login(api, "admin@example.com")
    boss = await login(api, "boss@example.com")

    refused = await put_roles(api, admin, "target@example.com", [protected])
    assert refused.status_code == 403
    assert refused.json()["error"]["details"] == {"roles": [protected]}

    granted = await put_roles(api, boss, "target@example.com", [protected])
    assert granted.status_code == 200


async def test_you_cannot_grant_permissions_you_do_not_hold_through_a_role(api: Api) -> None:
    # Allowed to assign roles, but holds neither company:view nor roles:view.
    await make_user(api, "hr@example.com", permissions={"core.users:admin", "core.users:view"})
    await make_user(api, "target@example.com")
    hr = await login(api, "hr@example.com")
    response = await put_roles(api, hr, "target@example.com", ["manager"])  # manager includes those
    assert response.status_code == 403
    missing = response.json()["error"]["details"]["permissions"]
    assert set(missing) == {"core.company:view", "core.roles:view"}

    ok = await put_roles(api, hr, "target@example.com", ["collaborator"])  # grants nothing
    assert ok.status_code == 200


async def test_you_cannot_grant_direct_permissions_you_do_not_hold(api: Api) -> None:
    await make_user(api, "hr@example.com", permissions={"core.users:admin", "core.users:view"})
    await make_user(api, "target@example.com")
    hr = await login(api, "hr@example.com")
    ident, version = await user_id(api, "target@example.com")
    url = f"{BASE}/users/{ident}/permissions"

    refused = await api.client.put(
        url, headers=bearer(hr), json={"permissions": ["core.company:update"], "version": version}
    )
    assert refused.status_code == 403
    allowed = await api.client.put(
        url, headers=bearer(hr), json={"permissions": ["core.users:view"], "version": version}
    )
    assert allowed.status_code == 200
    assert [p["key"] for p in allowed.json()["direct_permissions"]] == ["core.users:view"]


async def test_direct_permissions_take_effect_immediately(api: Api) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    await make_user(api, "ada@example.com")
    boss = await login(api, "boss@example.com")
    ada = await login(api, "ada@example.com")
    assert (await call(api, "GET", "/company", None, ada)).status_code == 403

    ident, version = await user_id(api, "ada@example.com")
    response = await api.client.put(
        f"{BASE}/users/{ident}/permissions",
        headers=bearer(boss),
        json={"permissions": ["core.company:view"], "version": version},
    )
    assert response.status_code == 200
    assert (await call(api, "GET", "/company", None, ada)).status_code == 404  # allowed now


async def test_a_role_cannot_carry_permissions_its_creator_lacks(api: Api) -> None:
    await make_user(api, "lead@example.com", permissions={"core.roles:create", "core.users:view"})
    lead = await login(api, "lead@example.com")
    refused = await call(
        api,
        "POST",
        "/roles",
        {"key": "sneaky", "name": "Sneaky", "permissions": ["core.users:delete"]},
        lead,
    )
    assert refused.status_code == 403
    allowed = await call(
        api,
        "POST",
        "/roles",
        {"key": "modest", "name": "Modest", "permissions": ["core.users:view"]},
        lead,
    )
    assert allowed.status_code == 201


async def test_an_ordinary_administrator_cannot_touch_administrator_accounts(api: Api) -> None:
    await make_user(api, "admin@example.com", roles=["admin"])
    await make_user(api, "other-admin@example.com", roles=["admin"])
    await make_user(api, "boss@example.com", roles=["super_admin"])
    admin = await login(api, "admin@example.com")

    for email in ("other-admin@example.com", "boss@example.com"):
        ident, version = await user_id(api, email)
        attempts = [
            ("POST", f"/users/{ident}/revoke-sessions", None),
            ("POST", f"/users/{ident}/password-reset", None),
            ("POST", f"/users/{ident}/2fa/reset", None),
            ("PATCH", f"/users/{ident}", {"full_name": "Hijacked", "version": version}),
            ("DELETE", f"/users/{ident}?version={version}", None),
            ("PUT", f"/users/{ident}/roles", {"roles": [], "version": version}),
        ]
        for method, path, body in attempts:
            response = await call(api, method, path, body, admin)
            assert response.status_code == 403, (email, method, path, response.text)


async def test_nobody_edits_their_own_privileges_or_removes_themselves(api: Api) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    await make_user(api, "second@example.com", roles=["super_admin"])
    boss = await login(api, "boss@example.com")
    ident, version = await user_id(api, "boss@example.com")

    attempts = [
        ("PUT", f"/users/{ident}/roles", {"roles": ["super_admin", "admin"], "version": version}),
        ("PUT", f"/users/{ident}/permissions", {"permissions": [], "version": version}),
        ("DELETE", f"/users/{ident}?version={version}", None),
        ("PATCH", f"/users/{ident}", {"is_active": False, "version": version}),
    ]
    for method, path, body in attempts:
        response = await call(api, method, path, body, boss)
        assert response.status_code == 403, (method, path, response.text)

    harmless = await call(
        api, "PATCH", f"/users/{ident}", {"full_name": "Boss B.", "version": version}, boss
    )
    assert harmless.status_code == 200  # ordinary edits of one's own data are fine


async def test_the_last_active_main_administrator_is_protected(api: Api) -> None:
    only = await make_user(api, "boss@example.com", roles=["super_admin"])
    with pytest.raises(ForbiddenError, match="last active main administrator"):
        await ensure_not_last_super_admin(api.session, only)

    second = await make_user(api, "second@example.com", roles=["super_admin"])
    await ensure_not_last_super_admin(api.session, only)  # two exist: fine
    second.is_active = False
    await api.session.commit()
    with pytest.raises(ForbiddenError):
        await ensure_not_last_super_admin(api.session, only)

    employee = await make_user(api, "emp@example.com", roles=["employee"])
    await ensure_not_last_super_admin(api.session, employee)  # not an administrator at all


async def test_system_roles_cannot_be_edited_even_by_the_main_administrator(api: Api) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    boss = await login(api, "boss@example.com")
    admin_role = (await api.session.execute(select(Role).where(Role.key == "admin"))).scalar_one()
    response = await api.client.put(
        f"{BASE}/roles/{admin_role.id}/permissions",
        headers=bearer(boss),
        json={"permissions": [], "version": admin_role.version},
    )
    assert response.status_code == 403
    gone = await api.client.delete(
        f"{BASE}/roles/{admin_role.id}?version={admin_role.version}", headers=bearer(boss)
    )
    assert gone.status_code == 403
