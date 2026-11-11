import re
from datetime import UTC, datetime

import pytest
from cryptography.fernet import Fernet

from app.core.security import (
    PasswordService,
    SecretBox,
    hash_identifier,
    match_totp_step,
    new_recovery_code,
    new_token,
    normalise_recovery_code,
    password_problems,
    recovery_code_hash,
    token_hash,
)

# RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"


@pytest.fixture(scope="module")
def passwords() -> PasswordService:
    return PasswordService(time_cost=1, memory_kib=8, parallelism=1)


def test_hash_is_argon2id_and_salted(passwords: PasswordService) -> None:
    first, second = passwords.hash("correct horse battery"), passwords.hash("correct horse battery")
    assert first.startswith("$argon2id$")
    assert first != second
    assert "correct horse" not in first


def test_verify(passwords: PasswordService) -> None:
    stored = passwords.hash("correct horse battery")
    assert passwords.verify(stored, "correct horse battery")
    assert not passwords.verify(stored, "correct horse batter")
    assert not passwords.verify("not a hash", "anything")
    assert not passwords.verify("", "anything")


async def test_missing_hash_never_verifies(passwords: PasswordService) -> None:
    assert await passwords.verify_async(None, "anything") is False
    stored = await passwords.hash_async("correct horse battery")
    assert await passwords.verify_async(stored, "correct horse battery") is True


def test_rehash_is_requested_when_parameters_get_stronger(passwords: PasswordService) -> None:
    stored = passwords.hash("correct horse battery")
    assert not passwords.needs_rehash(stored)
    stronger = PasswordService(time_cost=2, memory_kib=16, parallelism=1)
    assert stronger.needs_rehash(stored)


@pytest.mark.parametrize(
    ("password", "fragment"),
    [
        ("short1", "at least 12"),
        ("x" * 129, "at most 128"),
        ("Password1234", "too common"),
        ("aaaaaaaaaaaaaaaa", "too repetitive"),
        ("mario.rossi-is-here", "email"),
        ("x-mario.rossi@example.com-x", "email"),
        ("my-rossi-password-1", "name"),
    ],
)
def test_weak_passwords_are_refused(password: str, fragment: str) -> None:
    problems = password_problems(
        password, min_length=12, email="mario.rossi@example.com", full_name="Mario Rossi"
    )
    assert any(fragment in problem for problem in problems), problems


def test_a_long_passphrase_without_symbols_is_accepted() -> None:
    assert (
        password_problems(
            "correct horse battery staple", min_length=12, email="a@example.com", full_name="Ada"
        )
        == []
    )


def test_tokens_are_unpredictable_and_prefixed() -> None:
    tokens = {new_token("vat") for _ in range(500)}
    assert len(tokens) == 500
    sample = next(iter(tokens))
    assert re.fullmatch(r"vat_[A-Za-z0-9_-]{43}", sample)  # 256 bits, URL-safe


def test_token_hash_is_stable_and_not_reversible_by_inspection() -> None:
    token = new_token("vrt")
    assert token_hash(token) == token_hash(token)
    assert token not in token_hash(token)
    assert len(token_hash(token)) == 64
    assert hash_identifier(" Ada@Example.com ") == hash_identifier("ada@example.com")


def test_secret_box_roundtrip_and_tamper_detection() -> None:
    box = SecretBox([Fernet.generate_key().decode()])
    sealed = box.encrypt("JBSWY3DPEHPK3PXP")
    assert "JBSWY3DPEHPK3PXP" not in sealed
    assert box.decrypt(sealed) == "JBSWY3DPEHPK3PXP"
    with pytest.raises(ValueError, match="cannot decrypt"):
        box.decrypt(sealed[:-4] + "AAAA")


def test_secret_box_key_rotation() -> None:
    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    sealed_with_old = SecretBox([old_key]).encrypt("secret")
    rotated = SecretBox([new_key, old_key])  # new key first: it encrypts, both decrypt
    assert rotated.decrypt(sealed_with_old) == "secret"
    assert rotated.needs_reencryption(sealed_with_old)
    assert not rotated.needs_reencryption(rotated.encrypt("secret"))
    with pytest.raises(ValueError, match="cannot decrypt"):
        SecretBox([new_key]).decrypt(sealed_with_old)  # old key dropped too early


def at(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds, tz=UTC)


def test_totp_matches_the_rfc_6238_vector() -> None:
    # At T=59 the 8-digit code is 94287082, so the 6-digit code is its last six digits.
    assert match_totp_step(RFC_SECRET, "287082", now=at(59)) == 1
    assert match_totp_step(RFC_SECRET, "081804", now=at(1111111109)) == 37037036
    assert match_totp_step(RFC_SECRET, "050471", now=at(1111111111)) == 37037037


def test_totp_tolerates_one_step_of_clock_drift_only() -> None:
    assert match_totp_step(RFC_SECRET, "287082", now=at(59 + 30)) == 1  # one step late
    assert match_totp_step(RFC_SECRET, "287082", now=at(59 - 30)) == 1  # one step early
    assert match_totp_step(RFC_SECRET, "287082", now=at(59 + 90)) is None  # three steps late


# "\uff12..." are full-width digits: str.isdigit() is True for them, so only the
# isascii() guard keeps them out.
MALFORMED_CODES = [
    "",
    "28708",
    "2870822",
    "28708a",
    "\uff12\uff18\uff17\uff10\uff18\uff12",
    " 287082",
    "abcdef",
]


@pytest.mark.parametrize("code", MALFORMED_CODES)
def test_malformed_totp_codes_never_match(code: str) -> None:
    assert match_totp_step(RFC_SECRET, code, now=at(59)) is None


def test_recovery_codes() -> None:
    code = new_recovery_code()
    assert re.fullmatch(r"[0-9a-f]{4}(-[0-9a-f]{4}){3}", code)
    assert len({new_recovery_code() for _ in range(200)}) == 200
    # Spacing, dashes and case do not matter when the user retypes it.
    assert recovery_code_hash(code) == recovery_code_hash(code.upper().replace("-", " "))
    assert len(normalise_recovery_code(code)) == 16
    assert recovery_code_hash(code) != recovery_code_hash(new_recovery_code())


def test_a_short_local_part_alone_is_not_a_reason_to_refuse() -> None:
    # "ada" appears in many ordinary words; only the full address is forbidden then.
    assert (
        password_problems(
            "granada sunrise over the bay", min_length=12, email="ada@example.com", full_name=""
        )
        == []
    )
    assert password_problems(
        "ada@example.com!", min_length=12, email="ada@example.com", full_name=""
    )
