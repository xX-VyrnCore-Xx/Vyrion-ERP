import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

from tests.conftest import integration_settings


def test_single_migration_head() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert len(script.get_heads()) == 1


@pytest.mark.integration
def test_upgrade_and_downgrade_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = integration_settings()
    if settings is None:
        pytest.skip("VYRION_DATABASE_URL / VYRION_REDIS_URL not set")
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    engine = create_engine(settings.database_url.unicode_string())
    with engine.connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    engine.dispose()
    assert version == ScriptDirectory.from_config(config).get_current_head()
    command.downgrade(config, "base")
    command.upgrade(config, "head")
