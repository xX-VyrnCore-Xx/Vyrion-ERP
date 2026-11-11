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


@pytest.mark.integration
async def test_bootstrap_command_is_idempotent(migrated_database: object) -> None:
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    from app.cli import bootstrap
    from app.core.permissions import CATALOG_KEYS, SYSTEM_ROLES
    from app.models import Permission, Role

    await bootstrap()
    await bootstrap()
    settings = integration_settings()
    assert settings is not None
    engine = create_async_engine(settings.database_url.unicode_string(), poolclass=NullPool)
    async with engine.connect() as connection:
        permissions = (
            await connection.execute(select(func.count()).select_from(Permission))
        ).scalar_one()
        roles = (await connection.execute(select(func.count()).select_from(Role))).scalar_one()
    await engine.dispose()
    assert permissions == len(CATALOG_KEYS)
    assert roles >= len(SYSTEM_ROLES)
