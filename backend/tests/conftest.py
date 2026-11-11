import os
from collections.abc import AsyncIterator

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings
from app.main import create_app

# Closed local ports: connections are refused immediately, no network involved.
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://vyrion:unused@127.0.0.1:1/vyrion"
UNREACHABLE_REDIS_URL = "redis://127.0.0.1:1/0"


def integration_settings() -> Settings | None:
    database_url = os.environ.get("VYRION_DATABASE_URL")
    redis_url = os.environ.get("VYRION_REDIS_URL")
    if not database_url or not redis_url:
        return None
    return Settings(
        _env_file=None, environment="test", database_url=database_url, redis_url=redis_url
    )


async def _client(settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client


@pytest.fixture
async def offline_client() -> AsyncIterator[AsyncClient]:
    """App whose PostgreSQL and Redis are both unreachable."""
    settings = Settings(
        _env_file=None,
        environment="test",
        database_url=UNREACHABLE_DATABASE_URL,
        redis_url=UNREACHABLE_REDIS_URL,
        health_check_timeout=1.0,
    )
    async for client in _client(settings):
        yield client


@pytest.fixture
async def live_client() -> AsyncIterator[AsyncClient]:
    """App wired to the real services provided through the environment."""
    settings = integration_settings()
    if settings is None:
        pytest.skip("VYRION_DATABASE_URL / VYRION_REDIS_URL not set")
    async for client in _client(settings):
        yield client


@pytest.fixture(scope="session")
def migrated_database() -> Settings:
    """Real PostgreSQL at the latest schema revision; skips when not configured."""
    settings = integration_settings()
    if settings is None:
        pytest.skip("VYRION_DATABASE_URL / VYRION_REDIS_URL not set")
    command.upgrade(Config("alembic.ini"), "head")
    return settings


@pytest.fixture
async def db_session(migrated_database: Settings) -> AsyncIterator[AsyncSession]:
    """Session inside a transaction that is always rolled back: tests leave no data."""
    engine = create_async_engine(
        migrated_database.database_url.unicode_string(), poolclass=NullPool
    )
    async with engine.connect() as connection:
        transaction = await connection.begin()
        session = AsyncSession(
            bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()
    await engine.dispose()
