from typing import Any

import pytest
from sqlalchemy import select

from app.models import AuditLog, AuthSession
from tests.conftest import Api, FakeClock
from tests.helpers import (
    BASE,
    OTHER_PASSWORD,
    PASSWORD,
    audit_actions,
    bearer,
    count_login_events,
    error_code,
    fresh_user,
    login,
    make_user,
    post_login,
)

pytestmark = pytest.mark.integration


async def me(api: Api, tokens: dict[str, object]) -> int:
    return (await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))).status_code


async def refresh(api: Api, token: str):  # type: ignore[no-untyped-def]
    return await api.client.post(f"{BASE}/auth/refresh", json={"refresh_token": token})


# --- bearer tokens -----------------------------------------------------------------


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer vat_notarealtoken"},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "bearer "},
    ],
)
async def test_missing_or_invalid_credentials_are_401(api: Api, headers: dict[str, str]) -> None:
    response = await api.client.get(f"{BASE}/auth/me", headers=headers)
    assert response.status_code == 401
    assert error_code(response) == "unauthenticated"
    assert response.headers["www-authenticate"] == "Bearer"


async def test_the_refresh_token_is_not_accepted_as_an_access_token(api: Api) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    response = await api.client.get(
        f"{BASE}/auth/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}
    )
    assert response.status_code == 401


async def test_tokens_are_stored_only_as_hashes(api: Api) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    row = (await api.session.execute(select(AuthSession))).scalar_one()
    assert tokens["access_token"] not in (row.access_token_hash, row.refresh_token_hash)
    assert tokens["refresh_token"] not in (row.access_token_hash, row.refresh_token_hash)
    assert len(row.access_token_hash) == len(row.refresh_token_hash) == 64


async def test_access_tokens_expire_and_a_refresh_renews_them(
    api: Api, fake_clock: FakeClock
) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    assert await me(api, tokens) == 200

    fake_clock.advance(minutes=16)  # access lifetime is 15 minutes
    assert await me(api, tokens) == 401

    renewed = await refresh(api, tokens["refresh_token"])
    assert renewed.status_code == 200
    assert await me(api, renewed.json()) == 200


# --- refresh rotation and reuse detection -------------------------------------------


async def test_refresh_rotates_both_tokens(api: Api) -> None:
    await make_user(api, "ada@example.com")
    first = await login(api, "ada@example.com")
    second = (await refresh(api, first["refresh_token"])).json()

    assert second["session_id"] == first["session_id"]  # same device, new credentials
    assert second["access_token"] != first["access_token"]
    assert second["refresh_token"] != first["refresh_token"]
    assert await me(api, first) == 401  # the old access token died with the rotation
    assert await me(api, second) == 200


async def test_an_immediate_retry_of_the_old_refresh_token_is_refused_but_harmless(
    api: Api,
) -> None:
    """A client that lost the response may retry. That must not cost the user the session."""
    await make_user(api, "ada@example.com")
    first = await login(api, "ada@example.com")
    second = (await refresh(api, first["refresh_token"])).json()

    retry = await refresh(api, first["refresh_token"])
    assert retry.status_code == 401
    assert await me(api, second) == 200  # the legitimate session is intact


async def test_reusing_an_old_refresh_token_later_revokes_the_whole_session(
    api: Api, fake_clock: FakeClock
) -> None:
    """Either the thief or the owner used a copied token: both lose the session."""
    user = await make_user(api, "ada@example.com")
    first = await login(api, "ada@example.com")
    second = (await refresh(api, first["refresh_token"])).json()

    fake_clock.advance(seconds=11)  # beyond the grace window
    stolen = await refresh(api, first["refresh_token"])
    assert stolen.status_code == 401

    assert await me(api, second) == 401  # the rotated tokens are gone too
    assert (await refresh(api, second["refresh_token"])).status_code == 401
    row = (await api.session.execute(select(AuthSession))).scalar_one()
    assert row.revoked_reason == "refresh_reuse"
    assert "auth.refresh_reuse_detected" in await audit_actions(api)
    entry = (
        await api.session.execute(
            select(AuditLog).where(AuditLog.action == "auth.refresh_reuse_detected")
        )
    ).scalar_one()
    assert entry.changes == {"user_id": str(user.id)}


async def test_refresh_with_garbage_is_a_plain_401(api: Api) -> None:
    response = await refresh(api, "vrt_" + "x" * 43)
    assert response.status_code == 401
    assert error_code(response) == "unauthenticated"


async def test_a_session_cannot_outlive_its_absolute_limit(api: Api, fake_clock: FakeClock) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    # Keep refreshing every 13 days: the idle limit never trips, the absolute one must.
    for _ in range(2):
        fake_clock.advance(days=13)
        tokens = (await refresh(api, tokens["refresh_token"])).json()
    fake_clock.advance(days=5)  # day 31 of a 30-day session
    assert (await refresh(api, tokens["refresh_token"])).status_code == 401


async def test_an_idle_session_expires(api: Api, fake_clock: FakeClock) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    fake_clock.advance(days=15)  # refresh lifetime is 14 days
    assert (await refresh(api, tokens["refresh_token"])).status_code == 401


# --- logout and device management ----------------------------------------------------


async def test_logout_ends_the_session_for_good(api: Api) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    out = await api.client.post(f"{BASE}/auth/logout", headers=bearer(tokens))
    assert out.status_code == 204
    assert await me(api, tokens) == 401
    assert (await refresh(api, tokens["refresh_token"])).status_code == 401


async def test_logout_everywhere_disconnects_every_device(api: Api) -> None:
    await make_user(api, "ada@example.com")
    laptop = await login(api, "ada@example.com")
    phone = await login(api, "ada@example.com")
    result = await api.client.post(f"{BASE}/auth/logout-all", headers=bearer(laptop))
    assert result.json() == {"sessions_revoked": 2}
    assert await me(api, laptop) == 401
    assert await me(api, phone) == 401


async def test_sessions_can_be_listed_and_revoked_individually(api: Api) -> None:
    await make_user(api, "ada@example.com")
    laptop = await login(api, "ada@example.com")
    phone = await login(api, "ada@example.com")

    listing = await api.client.get(f"{BASE}/auth/sessions", headers=bearer(laptop))
    sessions = {item["id"]: item for item in listing.json()}
    assert set(sessions) == {laptop["session_id"], phone["session_id"]}
    assert sessions[laptop["session_id"]]["current"] is True
    assert sessions[phone["session_id"]]["current"] is False
    assert "access_token" not in listing.text

    gone = await api.client.delete(
        f"{BASE}/auth/sessions/{phone['session_id']}", headers=bearer(laptop)
    )
    assert gone.status_code == 204
    assert await me(api, phone) == 401
    assert await me(api, laptop) == 200
    again = await api.client.delete(
        f"{BASE}/auth/sessions/{phone['session_id']}", headers=bearer(laptop)
    )
    assert again.status_code == 404


async def test_nobody_can_revoke_someone_elses_session(api: Api) -> None:
    await make_user(api, "ada@example.com")
    await make_user(api, "bob@example.com")
    ada = await login(api, "ada@example.com")
    bob = await login(api, "bob@example.com")
    response = await api.client.delete(
        f"{BASE}/auth/sessions/{bob['session_id']}", headers=bearer(ada)
    )
    assert response.status_code == 404
    assert await me(api, bob) == 200


async def test_a_disabled_account_loses_access_immediately(api: Api) -> None:
    user = await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    user.is_active = False
    await api.session.commit()
    assert await me(api, tokens) == 401
    assert (await refresh(api, tokens["refresh_token"])).status_code == 401


# --- changing the password ------------------------------------------------------------


async def test_changing_the_password_keeps_this_device_and_drops_the_others(api: Api) -> None:
    await make_user(api, "ada@example.com")
    laptop = await login(api, "ada@example.com")
    phone = await login(api, "ada@example.com")
    result = await api.client.post(
        f"{BASE}/auth/password/change",
        headers=bearer(laptop),
        json={"current_password": PASSWORD, "new_password": OTHER_PASSWORD},
    )
    assert result.status_code == 200
    assert result.json() == {"sessions_revoked": 1}
    assert await me(api, laptop) == 200
    assert await me(api, phone) == 401
    assert (await post_login(api, "ada@example.com", PASSWORD)).status_code == 401
    assert (await post_login(api, "ada@example.com", OTHER_PASSWORD)).status_code == 200
    assert "auth.password_change" in await audit_actions(api)


async def test_a_wrong_current_password_is_refused_and_counts_as_a_failure(api: Api) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    response = await api.client.post(
        f"{BASE}/auth/password/change",
        headers=bearer(tokens),
        json={"current_password": "not my password!!", "new_password": OTHER_PASSWORD},
    )
    assert response.status_code == 422  # not 401: that would look like an expired session
    assert response.json()["error"]["details"] == {"field": "current_password"}
    assert await count_login_events(api, "ada@example.com", success=False) == 1
    assert (await fresh_user(api, "ada@example.com")).failed_login_count == 1


async def test_a_stolen_session_cannot_grind_through_password_guesses(api: Api) -> None:
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    for _ in range(5):
        await api.client.post(
            f"{BASE}/auth/password/change",
            headers=bearer(tokens),
            json={"current_password": "guess guess guess", "new_password": OTHER_PASSWORD},
        )
    assert await me(api, tokens) == 401  # the lock ended every session
    assert (await post_login(api, "ada@example.com")).status_code == 429


@pytest.mark.parametrize(
    ("new_password", "fragment"),
    [("short", "at least 12"), ("Password1234", "too common"), ("ada@example.com!", "email")],
)
async def test_weak_new_passwords_are_refused(api: Api, new_password: str, fragment: str) -> None:
    await make_user(api, "ada@example.com", full_name="Ada Lovelace")
    tokens = await login(api, "ada@example.com")
    response = await api.client.post(
        f"{BASE}/auth/password/change",
        headers=bearer(tokens),
        json={"current_password": PASSWORD, "new_password": new_password},
    )
    assert response.status_code == 422
    problems = response.json()["error"]["details"]["password"]
    assert any(fragment in problem for problem in problems)
    assert (await post_login(api, "ada@example.com", PASSWORD)).status_code == 200  # unchanged


# --- invitation and reset tokens -------------------------------------------------------


async def invite(api: Api, admin_tokens: dict[str, Any], email: str) -> dict[str, Any]:
    response = await api.client.post(
        f"{BASE}/users",
        headers=bearer(admin_tokens),
        json={"email": email, "full_name": "New Colleague"},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_a_new_user_chooses_their_own_password_with_a_one_time_token(api: Api) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    admin = await login(api, "boss@example.com")
    invitation = await invite(api, admin, "new@example.com")

    assert invitation["setup_token"].startswith("vst_")
    assert invitation["user"]["has_password"] is False
    assert (await post_login(api, "new@example.com", "anything at all")).status_code == 401

    token = invitation["setup_token"]
    weak = await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": token, "new_password": "short"}
    )
    assert weak.status_code == 422  # a refused password must not burn the token

    ok = await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": token, "new_password": OTHER_PASSWORD}
    )
    assert ok.status_code == 204
    assert (await post_login(api, "new@example.com", OTHER_PASSWORD)).status_code == 200

    reuse = await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": token, "new_password": PASSWORD}
    )
    assert reuse.status_code == 401
    assert "auth.password_set" in await audit_actions(api)


async def test_setup_tokens_expire(api: Api, fake_clock: FakeClock) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    admin = await login(api, "boss@example.com")
    token = (await invite(api, admin, "new@example.com"))["setup_token"]
    fake_clock.advance(hours=73)  # valid for 72
    response = await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": token, "new_password": OTHER_PASSWORD}
    )
    assert response.status_code == 401


async def test_a_new_reset_token_cancels_the_previous_one_and_ends_all_sessions(
    api: Api,
) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    victim = await make_user(api, "ada@example.com")
    admin = await login(api, "boss@example.com")
    ada = await login(api, "ada@example.com")

    first = await api.client.post(f"{BASE}/users/{victim.id}/password-reset", headers=bearer(admin))
    second = await api.client.post(
        f"{BASE}/users/{victim.id}/password-reset", headers=bearer(admin)
    )
    old, new = first.json()["setup_token"], second.json()["setup_token"]
    assert old != new

    stale = await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": old, "new_password": OTHER_PASSWORD}
    )
    assert stale.status_code == 401
    ok = await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": new, "new_password": OTHER_PASSWORD}
    )
    assert ok.status_code == 204
    assert await me(api, ada) == 401  # whoever was signed in with the old password is out
    assert (await post_login(api, "ada@example.com", OTHER_PASSWORD)).status_code == 200


async def test_a_password_reset_clears_a_lockout(api: Api) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    victim = await make_user(api, "ada@example.com")
    admin = await login(api, "boss@example.com")
    for _ in range(5):
        await post_login(api, "ada@example.com", "wrong wrong wrong")
    assert (await post_login(api, "ada@example.com")).status_code == 429

    token = (
        await api.client.post(f"{BASE}/users/{victim.id}/password-reset", headers=bearer(admin))
    ).json()["setup_token"]
    await api.client.post(
        f"{BASE}/auth/password/setup", json={"token": token, "new_password": OTHER_PASSWORD}
    )
    assert (await post_login(api, "ada@example.com", OTHER_PASSWORD)).status_code == 200
