import pytest
from sqlalchemy import select

from app.core import clock
from app.core.security import PasswordService, hash_identifier
from app.models import LoginEvent
from tests.conftest import Api, FakeClock
from tests.helpers import (
    BASE,
    PASSWORD,
    bearer,
    count_login_events,
    error_code,
    fresh_user,
    login,
    make_user,
    post_login,
)

pytestmark = pytest.mark.integration


async def test_login_returns_tokens_and_a_working_session(api: Api) -> None:
    await make_user(api, "ada@example.com", roles=["employee"])
    response = await post_login(api, "ada@example.com")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]
    body = response.json()
    assert body["status"] == "authenticated"
    tokens = body["tokens"]
    assert tokens["token_type"] == "Bearer"
    assert tokens["access_token"].startswith("vat_")
    assert tokens["refresh_token"].startswith("vrt_")
    assert tokens["access_token"] != tokens["refresh_token"]

    me = await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "ada@example.com"
    assert me.json()["permissions"] == ["core.company:view"]
    assert me.json()["mfa_verified"] is False
    # Credentials never travel back to the client.
    for forbidden in ("password_hash", "argon2", "totp_secret"):
        assert forbidden not in me.text


async def test_email_is_matched_case_insensitively(api: Api) -> None:
    await make_user(api, "ada@example.com")
    assert (await post_login(api, "  ADA@Example.COM ")).status_code == 200


async def test_unknown_account_and_wrong_password_look_identical(api: Api) -> None:
    await make_user(api, "ada@example.com")
    wrong = await post_login(api, "ada@example.com", "not the password at all")
    unknown = await post_login(api, "nobody@example.com", "not the password at all")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.headers["www-authenticate"] == "Bearer"
    assert error_code(wrong) == "unauthenticated"


async def test_disabled_and_not_yet_activated_accounts_cannot_sign_in(api: Api) -> None:
    await make_user(api, "off@example.com", active=False)
    await make_user(api, "invited@example.com", password=None)
    for email in ("off@example.com", "invited@example.com"):
        response = await post_login(api, email)
        assert response.status_code == 401
        assert error_code(response) == "unauthenticated"


async def test_account_locks_after_repeated_failures_even_for_the_right_password(
    api: Api, fake_clock: FakeClock
) -> None:
    await make_user(api, "ada@example.com")
    for _ in range(5):
        assert (await post_login(api, "ada@example.com", "wrong wrong wrong")).status_code == 401

    blocked = await post_login(api, "ada@example.com")  # the correct password
    assert blocked.status_code == 429
    assert error_code(blocked) == "rate_limited"
    assert int(blocked.headers["retry-after"]) > 0

    locked = await fresh_user(api, "ada@example.com")
    assert locked.locked_until is not None
    assert locked.locked_until > clock.utcnow()

    # The Redis window and the database lock both lapse with time.
    await api.app.state.limiter.reset(f"login-fail:{hash_identifier('ada@example.com')}")
    fake_clock.advance(minutes=16)
    assert (await post_login(api, "ada@example.com")).status_code == 200
    unlocked = await fresh_user(api, "ada@example.com")
    assert unlocked.locked_until is None
    assert unlocked.failed_login_count == 0


async def test_database_lock_holds_even_if_redis_forgets(api: Api) -> None:
    """An administrator-visible lock must survive a Redis flush."""
    await make_user(api, "ada@example.com")
    for _ in range(5):
        await post_login(api, "ada@example.com", "wrong wrong wrong")
    await api.app.state.limiter.reset(f"login-fail:{hash_identifier('ada@example.com')}")
    blocked = await post_login(api, "ada@example.com")
    assert blocked.status_code == 429


async def test_unknown_accounts_get_the_same_lockout_behaviour(api: Api) -> None:
    """Otherwise the lockout itself would reveal which addresses exist."""
    for _ in range(5):
        assert (await post_login(api, "ghost@example.com", "wrong wrong wrong")).status_code == 401
    assert (await post_login(api, "ghost@example.com")).status_code == 429


async def test_a_failure_for_one_account_does_not_block_another(api: Api) -> None:
    await make_user(api, "ada@example.com")
    await make_user(api, "bob@example.com")
    for _ in range(5):
        await post_login(api, "ada@example.com", "wrong wrong wrong")
    assert (await post_login(api, "bob@example.com")).status_code == 200


async def test_success_resets_the_failure_counter(api: Api) -> None:
    await make_user(api, "ada@example.com")
    for _ in range(4):
        await post_login(api, "ada@example.com", "wrong wrong wrong")
    assert (await post_login(api, "ada@example.com")).status_code == 200
    for _ in range(4):  # four more failures are tolerated again
        assert (await post_login(api, "ada@example.com", "wrong wrong wrong")).status_code == 401
    assert (await post_login(api, "ada@example.com")).status_code == 200


@pytest.mark.parametrize("api_settings", [{"login_rate_per_ip": 3, "login_max_failures": 20}])
async def test_attempts_are_limited_per_client_address(api: Api) -> None:
    await make_user(api, "ada@example.com")
    statuses = [
        (await post_login(api, "ada@example.com", "wrong wrong wrong")).status_code
        for _ in range(5)
    ]
    assert statuses == [401, 401, 401, 429, 429]


@pytest.mark.parametrize("api_settings", [{"api_rate_per_ip": 4}])
async def test_the_whole_api_is_rate_limited_but_health_is_not(api: Api) -> None:
    codes = [(await api.client.get(f"{BASE}/auth/me")).status_code for _ in range(6)]
    assert codes == [401, 401, 401, 401, 429, 429]
    # Monitoring must always be able to ask.
    assert (await api.client.get(f"{BASE}/health/live")).status_code == 200


async def test_every_attempt_lands_in_the_access_history(api: Api) -> None:
    user = await make_user(api, "ada@example.com")
    await post_login(api, "ada@example.com", "wrong wrong wrong")
    await post_login(api, "ghost@example.com", "wrong wrong wrong")
    tokens = await login(api, "ada@example.com")

    assert await count_login_events(api, "ada@example.com", success=False) == 1
    assert await count_login_events(api, "ada@example.com", success=True) == 1
    assert await count_login_events(api, "ghost@example.com", success=False) == 1  # no user row

    history = await api.client.get(f"{BASE}/auth/login-history", headers=bearer(tokens))
    assert history.status_code == 200
    events = history.json()
    assert [event["success"] for event in events] == [True, False]  # newest first
    assert events[1]["failure_reason"] == "invalid_credentials"
    assert events[1]["ip_address"] == "127.0.0.1"
    rows = (
        (await api.session.execute(select(LoginEvent).where(LoginEvent.user_id == user.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 2


async def test_password_hash_is_upgraded_transparently_at_login(api: Api) -> None:
    weak = PasswordService(time_cost=1, memory_kib=8, parallelism=1).hash(PASSWORD)
    user = await make_user(api, "ada@example.com")
    user.password_hash = weak
    await api.session.commit()
    stronger = PasswordService(time_cost=2, memory_kib=16, parallelism=1)
    api.app.state.auth.passwords = stronger

    assert (await post_login(api, "ada@example.com")).status_code == 200
    stored = (await fresh_user(api, "ada@example.com")).password_hash
    assert stored != weak
    assert stronger.verify(stored or "", PASSWORD)


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "ada@example.com"},
        {"email": "ada@example.com", "password": PASSWORD, "admin": True},
        {"email": "ada@example.com", "password": "x" * 2000},
        {"email": "", "password": PASSWORD},
        {"email": 5, "password": PASSWORD},
    ],
)
async def test_malformed_login_requests_are_rejected_without_echoing_input(
    api: Api, payload: dict[str, object]
) -> None:
    response = await api.client.post(f"{BASE}/auth/login", json=payload)
    assert response.status_code == 422
    assert error_code(response) == "invalid_input"
    assert "xxxxxxxx" not in response.text


async def test_an_outsider_cannot_sign_a_user_out_by_locking_their_account(api: Api) -> None:
    """The lock blocks new sign-ins; it must not cut sessions that are already open."""
    await make_user(api, "ada@example.com")
    tokens = await login(api, "ada@example.com")
    for _ in range(5):
        await post_login(api, "ada@example.com", "wrong wrong wrong")  # an attacker guessing
    assert (await post_login(api, "ada@example.com")).status_code == 429  # locked for new logins

    me = await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))
    assert me.status_code == 200  # ...but the owner is still working
    renewed = await api.client.post(
        f"{BASE}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert renewed.status_code == 200
