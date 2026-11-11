from typing import Any

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError

from app.core.config import Settings
from tests.conftest import TEST_ENCRYPTION_KEY

VALID_DB = "postgresql+psycopg://u:p@localhost:5432/db"
VALID_REDIS = "redis://localhost:6379/0"


def make(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": VALID_DB,
        "redis_url": VALID_REDIS,
        "encryption_keys": [TEST_ENCRYPTION_KEY],
        **overrides,
    }
    return Settings(_env_file=None, **values)


def test_defaults_to_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VYRION_ENVIRONMENT", raising=False)
    settings = make()
    assert settings.environment == "development"
    assert not settings.is_production


def test_database_url_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VYRION_DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, redis_url=VALID_REDIS, encryption_keys=[TEST_ENCRYPTION_KEY])


@pytest.mark.parametrize(
    "url", ["postgresql://u:p@localhost/db", "postgresql+asyncpg://u:p@localhost/db"]
)
def test_database_url_must_use_psycopg(url: str) -> None:
    with pytest.raises(ValidationError):
        make(database_url=url)


def test_unknown_environment_rejected() -> None:
    with pytest.raises(ValidationError):
        make(environment="staging")


def test_encryption_key_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VYRION_ENCRYPTION_KEYS", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url=VALID_DB, redis_url=VALID_REDIS)


@pytest.mark.parametrize("bad", ["", "not-a-key", "short", "a" * 44])
def test_invalid_encryption_keys_are_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        make(encryption_keys=[bad])


def test_encryption_keys_can_come_from_a_comma_separated_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    second = Fernet.generate_key().decode()
    monkeypatch.setenv("VYRION_ENCRYPTION_KEYS", f"{TEST_ENCRYPTION_KEY}, {second}")
    settings = Settings(_env_file=None, database_url=VALID_DB, redis_url=VALID_REDIS)
    assert [key.get_secret_value() for key in settings.encryption_keys] == [
        TEST_ENCRYPTION_KEY,
        second,
    ]


def test_keys_do_not_leak_through_repr() -> None:
    assert TEST_ENCRYPTION_KEY not in repr(make())


def test_production_refuses_weak_password_hashing() -> None:
    with pytest.raises(ValidationError, match="Argon2id"):
        make(environment="production", argon2_memory_kib=8, argon2_time_cost=1)
    make(environment="production")  # the defaults are acceptable


def test_session_lifetimes_must_be_consistent() -> None:
    with pytest.raises(ValidationError):
        make(refresh_token_ttl_seconds=7200, session_absolute_ttl_seconds=3600)
