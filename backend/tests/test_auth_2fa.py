import pyotp
import pytest
from httpx import Response
from sqlalchemy import func, select

from app.core import clock
from app.models import LoginChallenge, RecoveryCode
from tests.conftest import Api, FakeClock
from tests.helpers import (
    BASE,
    PASSWORD,
    audit_actions,
    bearer,
    error_code,
    fresh_user,
    login,
    make_user,
    post_login,
    totp_now,
)

pytestmark = pytest.mark.integration

EMAIL = "ada@example.com"


def wrong_code(secret: str) -> str:
    """A well-formed code that is certainly not valid right now (any step within the window)."""
    totp = pyotp.TOTP(secret)
    step = int(clock.utcnow().timestamp()) // 30
    valid = {totp.generate_otp(step + offset) for offset in range(-2, 3)}
    return next(
        code for code in (f"{n:06d}" for n in range(111111, 999999, 7)) if code not in valid
    )


async def enable_2fa(api: Api, tokens: dict[str, object]) -> tuple[str, list[str]]:
    setup = await api.client.post(f"{BASE}/auth/2fa/setup", headers=bearer(tokens))
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    enabled = await api.client.post(
        f"{BASE}/auth/2fa/enable", headers=bearer(tokens), json={"code": totp_now(secret)}
    )
    assert enabled.status_code == 200, enabled.text
    return secret, enabled.json()["recovery_codes"]


async def start_login(api: Api) -> str:
    response = await post_login(api, EMAIL)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "second_factor_required"
    assert body["tokens"] is None
    token: str = body["second_factor"]["challenge_token"]
    return token


async def second_factor(api: Api, challenge: str, code: str) -> Response:
    return await api.client.post(
        f"{BASE}/auth/login/second-factor", json={"challenge_token": challenge, "code": code}
    )


async def user_with_2fa(api: Api, fake_clock: FakeClock) -> tuple[str, list[str]]:
    await make_user(api, EMAIL, roles=["employee"])
    tokens = await login(api, EMAIL)
    secret, codes = await enable_2fa(api, tokens)
    fake_clock.advance(seconds=30)  # the enabling code's step must not be reusable
    return secret, codes


# --- enrolment --------------------------------------------------------------------------


async def test_setup_gives_a_secret_and_stores_it_encrypted(api: Api) -> None:
    await make_user(api, EMAIL)
    tokens = await login(api, EMAIL)
    response = await api.client.post(f"{BASE}/auth/2fa/setup", headers=bearer(tokens))
    body = response.json()
    assert response.headers["cache-control"] == "no-store"
    assert body["otpauth_uri"].startswith("otpauth://totp/")
    assert (
        "issuer=Vyrion+ERP" in body["otpauth_uri"] or "issuer=Vyrion%20ERP" in body["otpauth_uri"]
    )
    assert body["secret"] in body["otpauth_uri"]

    stored = (await fresh_user(api, EMAIL)).totp_secret_encrypted
    assert stored is not None
    assert body["secret"] not in stored  # never in the clear at rest
    assert api.app.state.auth.box.decrypt(stored) == body["secret"]


async def test_enabling_needs_a_correct_code_and_a_started_setup(api: Api) -> None:
    await make_user(api, EMAIL)
    tokens = await login(api, EMAIL)
    early = await api.client.post(
        f"{BASE}/auth/2fa/enable", headers=bearer(tokens), json={"code": "123456"}
    )
    assert early.status_code == 422  # setup not started

    secret = (await api.client.post(f"{BASE}/auth/2fa/setup", headers=bearer(tokens))).json()[
        "secret"
    ]
    bad = await api.client.post(
        f"{BASE}/auth/2fa/enable", headers=bearer(tokens), json={"code": wrong_code(secret)}
    )
    assert bad.status_code == 422
    assert (await fresh_user(api, EMAIL)).totp_enabled is False


async def test_enabling_returns_ten_recovery_codes_stored_only_as_hashes(api: Api) -> None:
    await make_user(api, EMAIL)
    tokens = await login(api, EMAIL)
    _, codes = await enable_2fa(api, tokens)
    assert len(codes) == len(set(codes)) == 10

    rows = (await api.session.execute(select(RecoveryCode))).scalars().all()
    assert len(rows) == 10
    stored = {row.code_hash for row in rows}
    assert not stored & set(codes)
    assert not any(code.replace("-", "") in hash_ for code in codes for hash_ in stored)

    me = await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))
    assert me.json()["user"]["totp_enabled"] is True
    assert "recovery_codes" not in me.text
    assert "auth.2fa_enabled" in await audit_actions(api)


async def test_setup_cannot_be_restarted_once_enabled(api: Api) -> None:
    await make_user(api, EMAIL)
    tokens = await login(api, EMAIL)
    await enable_2fa(api, tokens)
    again = await api.client.post(f"{BASE}/auth/2fa/setup", headers=bearer(tokens))
    assert again.status_code == 409


# --- signing in with a second factor -----------------------------------------------------


async def test_login_asks_for_the_second_factor_and_issues_no_tokens_yet(
    api: Api, fake_clock: FakeClock
) -> None:
    await user_with_2fa(api, fake_clock)
    challenge = await start_login(api)
    # The challenge is not a credential.
    response = await api.client.get(
        f"{BASE}/auth/me", headers={"Authorization": f"Bearer {challenge}"}
    )
    assert response.status_code == 401
    sessions = (
        await api.session.execute(select(func.count()).select_from(LoginChallenge))
    ).scalar_one()
    assert sessions == 1


async def test_a_correct_code_completes_the_login(api: Api, fake_clock: FakeClock) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    challenge = await start_login(api)
    done = await second_factor(api, challenge, totp_now(secret))
    assert done.status_code == 200
    tokens = done.json()
    me = await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))
    assert me.json()["mfa_verified"] is True

    # The challenge is single use.
    left = (
        await api.session.execute(select(func.count()).select_from(LoginChallenge))
    ).scalar_one()
    assert left == 0
    assert (await second_factor(api, challenge, totp_now(secret))).status_code == 401


async def test_a_wrong_code_is_refused_without_saying_why(api: Api, fake_clock: FakeClock) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    challenge = await start_login(api)
    response = await second_factor(api, challenge, wrong_code(secret))
    assert response.status_code == 401
    assert error_code(response) == "unauthenticated"
    # The right code still works afterwards: one typo does not burn the challenge.
    assert (await second_factor(api, challenge, totp_now(secret))).status_code == 200


async def test_guessing_codes_is_cut_short(api: Api, fake_clock: FakeClock) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    challenge = await start_login(api)
    for _ in range(5):
        assert (await second_factor(api, challenge, wrong_code(secret))).status_code == 401
    # Even the correct code is useless now: the challenge is spent and the account locked.
    assert (await second_factor(api, challenge, totp_now(secret))).status_code == 401
    assert (await post_login(api, EMAIL)).status_code == 429


async def test_a_code_cannot_be_used_twice(api: Api, fake_clock: FakeClock) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    code = totp_now(secret)
    first = await second_factor(api, await start_login(api), code)
    assert first.status_code == 200

    replay = await second_factor(api, await start_login(api), code)  # same 30 s window
    assert replay.status_code == 401

    fake_clock.advance(seconds=30)
    fresh = await second_factor(api, await start_login(api), totp_now(secret))
    assert fresh.status_code == 200


async def test_a_code_from_the_previous_step_is_tolerated_for_clock_drift(
    api: Api, fake_clock: FakeClock
) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    # One more step so that "the previous step" is newer than the one used to enable 2FA
    # (which anti-replay rightly refuses).
    fake_clock.advance(seconds=30)
    previous = pyotp.TOTP(secret).at(int(clock.utcnow().timestamp()) - 30)
    assert (await second_factor(api, await start_login(api), previous)).status_code == 200


async def test_challenges_expire(api: Api, fake_clock: FakeClock) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    challenge = await start_login(api)
    fake_clock.advance(minutes=6)  # five-minute lifetime
    assert (await second_factor(api, challenge, totp_now(secret))).status_code == 401


async def test_a_challenge_dies_with_the_account(api: Api, fake_clock: FakeClock) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    challenge = await start_login(api)
    user = await fresh_user(api, EMAIL)
    user.is_active = False
    await api.session.commit()
    assert (await second_factor(api, challenge, totp_now(secret))).status_code == 401


# --- recovery codes ----------------------------------------------------------------------


async def test_a_recovery_code_works_exactly_once(api: Api, fake_clock: FakeClock) -> None:
    _, codes = await user_with_2fa(api, fake_clock)
    typed = codes[0].upper().replace("-", " ")  # users retype codes sloppily
    assert (await second_factor(api, await start_login(api), typed)).status_code == 200
    assert (await second_factor(api, await start_login(api), codes[0])).status_code == 401
    assert (await second_factor(api, await start_login(api), codes[1])).status_code == 200


async def test_a_made_up_recovery_code_fails(api: Api, fake_clock: FakeClock) -> None:
    await user_with_2fa(api, fake_clock)
    response = await second_factor(api, await start_login(api), "0000-0000-0000-0000")
    assert response.status_code == 401


# --- turning it off ----------------------------------------------------------------------


async def test_disabling_needs_the_password_and_a_code(api: Api, fake_clock: FakeClock) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    tokens = (await second_factor(api, await start_login(api), totp_now(secret))).json()
    fake_clock.advance(seconds=30)

    no_password = await api.client.post(
        f"{BASE}/auth/2fa/disable",
        headers=bearer(tokens),
        json={"password": "wrong wrong wrong", "code": totp_now(secret)},
    )
    assert no_password.status_code == 422
    assert (await fresh_user(api, EMAIL)).totp_enabled is True

    fake_clock.advance(seconds=30)
    done = await api.client.post(
        f"{BASE}/auth/2fa/disable",
        headers=bearer(tokens),
        json={"password": PASSWORD, "code": totp_now(secret)},
    )
    assert done.status_code == 204
    user = await fresh_user(api, EMAIL)
    assert (user.totp_enabled, user.totp_secret_encrypted) == (False, None)
    leftover = (
        await api.session.execute(select(func.count()).select_from(RecoveryCode))
    ).scalar_one()
    assert leftover == 0
    assert (await post_login(api, EMAIL)).json()["status"] == "authenticated"
    assert "auth.2fa_disabled" in await audit_actions(api)


async def test_an_administrator_can_reset_a_lost_second_factor(
    api: Api, fake_clock: FakeClock
) -> None:
    await make_user(api, "boss@example.com", roles=["super_admin"])
    boss = await login(api, "boss@example.com")
    await make_user(api, EMAIL)
    ada = await login(api, EMAIL)
    await enable_2fa(api, ada)
    target = await fresh_user(api, EMAIL)

    reset = await api.client.post(f"{BASE}/users/{target.id}/2fa/reset", headers=bearer(boss))
    assert reset.status_code == 204
    assert (await api.client.get(f"{BASE}/auth/me", headers=bearer(ada))).status_code == 401
    assert (await fresh_user(api, EMAIL)).totp_enabled is False
    assert (await post_login(api, EMAIL)).json()["status"] == "authenticated"
    assert "auth.2fa_reset" in await audit_actions(api)


async def test_a_plain_employee_cannot_reset_anyones_second_factor(api: Api) -> None:
    await make_user(api, "emp@example.com", roles=["employee"])
    victim = await make_user(api, EMAIL)
    tokens = await login(api, "emp@example.com")
    response = await api.client.post(f"{BASE}/users/{victim.id}/2fa/reset", headers=bearer(tokens))
    assert response.status_code == 403


async def test_probing_the_disable_endpoint_from_a_stolen_session_ends_every_session(
    api: Api, fake_clock: FakeClock
) -> None:
    secret, _ = await user_with_2fa(api, fake_clock)
    tokens = (await second_factor(api, await start_login(api), totp_now(secret))).json()
    for _ in range(5):
        await api.client.post(
            f"{BASE}/auth/2fa/disable",
            headers=bearer(tokens),
            json={"password": "guess guess guess", "code": wrong_code(secret)},
        )
    assert (await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))).status_code == 401
    assert (await post_login(api, EMAIL)).status_code == 429


# --- new recovery codes -----------------------------------------------------------------


async def test_regenerating_recovery_codes_replaces_the_old_ones(
    api: Api, fake_clock: FakeClock
) -> None:
    secret, old_codes = await user_with_2fa(api, fake_clock)
    tokens = await login_with_2fa(api, secret, fake_clock)
    response = await api.client.post(
        f"{BASE}/auth/2fa/recovery-codes",
        headers=bearer(tokens),
        json={"password": PASSWORD, "code": totp_now(secret)},
    )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    new_codes = response.json()["recovery_codes"]
    assert len(new_codes) == len(old_codes) == 10
    assert set(new_codes).isdisjoint(old_codes)
    user = await fresh_user(api, EMAIL)
    stored = (
        await api.session.execute(select(func.count()).where(RecoveryCode.user_id == user.id))
    ).scalar_one()
    assert stored == 10
    assert "auth.recovery_codes_regenerated" in await audit_actions(api, entity_id=user.id)

    # an old code no longer opens the second step, a new one does
    fake_clock.advance(seconds=30)
    challenge = await start_login(api)
    assert (await second_factor(api, challenge, old_codes[0])).status_code != 200
    challenge = await start_login(api)
    assert (await second_factor(api, challenge, new_codes[0])).status_code == 200


async def test_regenerating_needs_the_password_and_a_valid_code(
    api: Api, fake_clock: FakeClock
) -> None:
    secret, old_codes = await user_with_2fa(api, fake_clock)
    tokens = await login_with_2fa(api, secret, fake_clock)
    for body in (
        {"password": "not-the-password-0", "code": totp_now(secret)},
        {"password": PASSWORD, "code": wrong_code(secret)},
    ):
        response = await api.client.post(
            f"{BASE}/auth/2fa/recovery-codes", headers=bearer(tokens), json=body
        )
        assert response.status_code == 422, response.text
    user = await fresh_user(api, EMAIL)
    # nothing was replaced
    ok = await api.session.execute(select(func.count()).where(RecoveryCode.user_id == user.id))
    assert ok.scalar_one() == len(old_codes)


async def test_regenerating_without_2fa_is_refused(api: Api) -> None:
    await make_user(api, EMAIL, roles=["employee"])
    tokens = await login(api, EMAIL)
    response = await api.client.post(
        f"{BASE}/auth/2fa/recovery-codes",
        headers=bearer(tokens),
        json={"password": PASSWORD, "code": "123456"},
    )
    assert response.status_code == 409
    assert error_code(response) == "conflict"


async def login_with_2fa(api: Api, secret: str, fake_clock: FakeClock) -> dict[str, object]:
    """Sign in through both steps with the authenticator code of the current time step."""
    challenge = await start_login(api)
    response = await second_factor(api, challenge, totp_now(secret))
    assert response.status_code == 200, response.text
    fake_clock.advance(seconds=30)  # the next code (a new step) must be usable for the action
    tokens: dict[str, object] = response.json()
    return tokens


# --- mandatory 2FA for administrators ---------------------------------------------------


@pytest.mark.parametrize("api_settings", [{"require_2fa_for_admins": True}])
async def test_an_admin_without_2fa_can_only_turn_it_on(api: Api) -> None:
    await make_user(api, EMAIL, roles=["super_admin"])
    tokens = await login(api, EMAIL)
    headers = bearer(tokens)

    me = await api.client.get(f"{BASE}/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["second_factor_required"] is True

    for path in ("/users", "/roles", "/company", "/audit-log"):
        blocked = await api.client.get(f"{BASE}{path}", headers=headers)
        assert blocked.status_code == 403, path
        assert error_code(blocked) == "second_factor_required"

    secret, _ = await enable_2fa(api, tokens)  # the way out stays open
    me = await api.client.get(f"{BASE}/auth/me", headers=headers)
    assert me.json()["second_factor_required"] is False
    assert (await api.client.get(f"{BASE}/users", headers=headers)).status_code == 200
    assert secret


@pytest.mark.parametrize("api_settings", [{"require_2fa_for_admins": True}])
async def test_the_rule_does_not_touch_other_accounts(api: Api) -> None:
    await make_user(api, EMAIL, roles=["employee"])
    tokens = await login(api, EMAIL)
    me = await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))
    assert me.json()["second_factor_required"] is False
    assert (await api.client.get(f"{BASE}/company", headers=bearer(tokens))).status_code != 403


async def test_the_rule_is_off_by_default(api: Api) -> None:
    await make_user(api, EMAIL, roles=["super_admin"])
    tokens = await login(api, EMAIL)
    me = await api.client.get(f"{BASE}/auth/me", headers=bearer(tokens))
    assert me.json()["second_factor_required"] is False
    assert (await api.client.get(f"{BASE}/users", headers=bearer(tokens))).status_code == 200
