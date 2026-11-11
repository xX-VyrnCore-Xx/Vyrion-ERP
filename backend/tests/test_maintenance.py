from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.core import clock
from app.core.errors import ConflictError, InvalidInputError
from app.core.security import new_token, token_hash
from app.models import AuthSession, LoginChallenge, PasswordSetupToken, Role, User
from app.services.maintenance import create_first_admin, purge_expired
from tests.conftest import Api
from tests.helpers import PASSWORD, bearer, login, make_user, post_login

pytestmark = pytest.mark.integration


async def create_admin(api: Api, **overrides: str) -> User:
    values = {
        "email": "Boss@Example.com",
        "full_name": "Big Boss",
        "password": PASSWORD,
        **overrides,
    }
    return await create_first_admin(
        api.session, api.app.state.auth.passwords, min_password_length=12, **values
    )


async def test_the_first_administrator_is_created_and_can_sign_in(api: Api) -> None:
    user = await create_admin(api)
    await api.session.commit()
    assert user.email == "boss@example.com"
    assert [role.key for role in user.roles] == ["super_admin"]
    assert user.password_hash and user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash

    tokens = await login(api, "boss@example.com")
    me = await api.client.get("/api/v1/auth/me", headers=bearer(tokens))
    assert "core.users:admin" in me.json()["permissions"]


async def test_there_can_be_only_one_first_administrator(api: Api) -> None:
    await create_admin(api)
    await api.session.commit()
    with pytest.raises(ConflictError, match="already exists"):
        await create_admin(api, email="second@example.com")


async def test_the_first_administrator_needs_a_decent_password(api: Api) -> None:
    with pytest.raises(InvalidInputError) as error:
        await create_admin(api, password="short")
    assert "password" in error.value.details


async def test_a_database_without_system_roles_is_reported_clearly(api: Api) -> None:
    await api.session.execute(Role.__table__.delete())  # type: ignore[attr-defined]
    with pytest.raises(ConflictError, match="bootstrap"):
        await create_admin(api)


async def test_purge_removes_only_what_can_no_longer_be_used(api: Api) -> None:
    user = await make_user(api, "ada@example.com")
    live = await login(api, "ada@example.com")
    now = clock.utcnow()

    def session_row(**kwargs: object) -> AuthSession:
        defaults: dict[str, object] = {
            "user_id": user.id,
            "access_token_hash": token_hash(new_token("vat")),
            "access_expires_at": now,
            "refresh_token_hash": token_hash(new_token("vrt")),
            "refresh_expires_at": now + timedelta(days=1),
            "absolute_expires_at": now + timedelta(days=1),
            "last_used_at": now,
        }
        return AuthSession(**{**defaults, **kwargs})

    old = session_row(
        refresh_expires_at=now - timedelta(days=8), absolute_expires_at=now - timedelta(days=8)
    )
    recently_revoked = session_row(revoked_at=now - timedelta(days=1), revoked_reason="logout")
    long_revoked = session_row(revoked_at=now - timedelta(days=9), revoked_reason="logout")
    api.session.add_all([old, recently_revoked, long_revoked])
    api.session.add_all(
        [
            LoginChallenge(
                user_id=user.id, token_hash=token_hash("a"), expires_at=now - timedelta(minutes=1)
            ),
            LoginChallenge(
                user_id=user.id, token_hash=token_hash("b"), expires_at=now + timedelta(minutes=4)
            ),
            PasswordSetupToken(
                user_id=user.id,
                token_hash=token_hash("c"),
                purpose="reset",
                expires_at=now - timedelta(days=8),
            ),
            PasswordSetupToken(
                user_id=user.id,
                token_hash=token_hash("d"),
                purpose="reset",
                expires_at=now + timedelta(hours=1),
            ),
        ]
    )
    await api.session.commit()

    counts = await purge_expired(api.session)
    assert counts == {"sessions": 2, "challenges": 1, "setup_tokens": 1}

    remaining = {row.id for row in (await api.session.execute(select(AuthSession))).scalars()}
    assert recently_revoked.id in remaining  # kept so a reused refresh token is still recognised
    assert old.id not in remaining and long_revoked.id not in remaining
    # A live session is untouched by the purge.
    assert (await api.client.get("/api/v1/auth/me", headers=bearer(live))).status_code == 200
    assert (await post_login(api, "ada@example.com")).status_code == 200
    count = (
        await api.session.execute(select(func.count()).select_from(LoginChallenge))
    ).scalar_one()
    assert count == 1
