"""Shared helpers for the API tests."""

from collections.abc import Iterable
from typing import Any

import pyotp
from httpx import Response
from sqlalchemy import func, select

from app.core import clock
from app.models import AuditLog, LoginEvent, Permission, Role, User
from tests.conftest import Api

BASE = "/api/v1"
PASSWORD = "correct horse battery staple"
OTHER_PASSWORD = "another long passphrase 42"


def bearer(tokens: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def make_user(
    api: Api,
    email: str,
    *,
    roles: Iterable[str] = (),
    permissions: Iterable[str] = (),
    password: str | None = PASSWORD,
    full_name: str = "Test Person",
    active: bool = True,
) -> User:
    """Insert an account directly, bypassing the API (so tests control the starting state)."""
    session = api.session
    role_rows = list(
        (await session.execute(select(Role).where(Role.key.in_(set(roles))))).scalars().all()
    )
    permission_rows = list(
        (await session.execute(select(Permission).where(Permission.key.in_(set(permissions)))))
        .scalars()
        .all()
    )
    user = User(
        email=email,
        full_name=full_name,
        is_active=active,
        password_hash=api.app.state.auth.passwords.hash(password) if password else None,
        roles=role_rows,
        direct_permissions=permission_rows,
    )
    session.add(user)
    await session.commit()
    return user


async def post_login(api: Api, email: str, password: str = PASSWORD) -> Response:
    return await api.client.post(f"{BASE}/auth/login", json={"email": email, "password": password})


async def login(api: Api, email: str, password: str = PASSWORD) -> dict[str, Any]:
    response = await post_login(api, email, password)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "authenticated", body
    tokens: dict[str, Any] = body["tokens"]
    return tokens


async def fresh_user(api: Api, email: str) -> User:
    """The row as it is in the database now, not as the test session last saw it."""
    query = select(User).where(User.email == email).execution_options(populate_existing=True)
    return (await api.session.execute(query)).scalar_one()


async def count_login_events(api: Api, email: str, *, success: bool | None = None) -> int:
    query = select(func.count()).select_from(LoginEvent).where(LoginEvent.email_attempted == email)
    if success is not None:
        query = query.where(LoginEvent.success.is_(success))
    return int((await api.session.execute(query)).scalar_one())


async def audit_actions(api: Api, *, entity_id: Any = None) -> list[str]:
    query = select(AuditLog.action).order_by(AuditLog.id)
    if entity_id is not None:
        query = query.where(AuditLog.entity_id == entity_id)
    return list((await api.session.execute(query)).scalars().all())


def totp_now(secret: str) -> str:
    return pyotp.TOTP(secret).at(clock.utcnow())


def error_code(response: Response) -> str:
    code: str = response.json()["error"]["code"]
    return code
