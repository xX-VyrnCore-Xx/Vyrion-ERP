from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings

VALID_DB = "postgresql+psycopg://u:p@localhost:5432/db"
VALID_REDIS = "redis://localhost:6379/0"


def make(**overrides: Any) -> Settings:
    values: dict[str, Any] = {"database_url": VALID_DB, "redis_url": VALID_REDIS, **overrides}
    return Settings(_env_file=None, **values)


def test_defaults_to_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VYRION_ENVIRONMENT", raising=False)
    settings = make()
    assert settings.environment == "development"
    assert not settings.is_production


def test_database_url_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VYRION_DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, redis_url=VALID_REDIS)


@pytest.mark.parametrize(
    "url", ["postgresql://u:p@localhost/db", "postgresql+asyncpg://u:p@localhost/db"]
)
def test_database_url_must_use_psycopg(url: str) -> None:
    with pytest.raises(ValidationError):
        make(database_url=url)


def test_unknown_environment_rejected() -> None:
    with pytest.raises(ValidationError):
        make(environment="staging")
