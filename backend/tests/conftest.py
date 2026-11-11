import os
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from cryptography.fernet import Fernet
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.deps import get_session
from app.core import clock
from app.core.config import Settings
from app.main import create_app

# Closed local ports: connections are refused immediately, no network involved.
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://vyrion:unused@127.0.0.1:1/vyrion"
UNREACHABLE_REDIS_URL = "redis://127.0.0.1:1/0"

# Generated on every run: no key material is ever committed.
TEST_ENCRYPTION_KEY = Fernet.generate_key().decode()


def make_settings(**overrides: Any) -> Settings:
    """Settings for tests: cheap password hashing (never used in production, where the
    minimums are enforced), a throw-away key and an isolated Redis key prefix."""
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": UNREACHABLE_DATABASE_URL,
        "redis_url": UNREACHABLE_REDIS_URL,
        "encryption_keys": [TEST_ENCRYPTION_KEY],
        "argon2_time_cost": 1,
        "argon2_memory_kib": 8,
        "argon2_parallelism": 1,
        "redis_key_prefix": f"vyrion-test-{uuid.uuid4().hex[:8]}",
        **overrides,
    }
    return Settings(_env_file=None, **values)


def integration_settings(**overrides: Any) -> Settings | None:
    database_url = os.environ.get("VYRION_DATABASE_URL")
    redis_url = os.environ.get("VYRION_REDIS_URL")
    if not database_url or not redis_url:
        return None
    return make_settings(database_url=database_url, redis_url=redis_url, **overrides)


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
    async for client in _client(make_settings(health_check_timeout=1.0)):
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
async def db_connection(migrated_database: Settings) -> AsyncIterator[AsyncConnection]:
    """A connection inside a transaction that is always rolled back: tests leave no data."""
    engine = create_async_engine(
        migrated_database.database_url.unicode_string(), poolclass=NullPool
    )
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()
    await engine.dispose()


def _session_on(connection: AsyncConnection) -> AsyncSession:
    # "create_savepoint": a commit inside the code under test releases a savepoint only.
    return AsyncSession(
        bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )


@pytest.fixture
async def db_session(db_connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    session = _session_on(db_connection)
    try:
        yield session
    finally:
        await session.close()


# --- API tests ------------------------------------------------------------------


@dataclass
class FakeClock:
    """Moves ``app.core.clock.utcnow`` forward without sleeping."""

    offset: timedelta = field(default_factory=timedelta)

    def advance(self, **kwargs: float) -> None:
        self.offset += timedelta(**kwargs)


@pytest.fixture
def fake_clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    state = FakeClock()
    real = clock.utcnow
    monkeypatch.setattr(clock, "utcnow", lambda: real() + state.offset)
    return state


@dataclass
class Api:
    client: AsyncClient
    app: FastAPI
    settings: Settings
    session: AsyncSession  # the test's own view of the same transaction


SettingsFactory = Callable[..., Settings]


@pytest.fixture
def api_settings() -> dict[str, Any]:
    """Tests override entries here (before using ``api``) to change the app's settings."""
    return {}


@pytest.fixture
async def api(
    migrated_database: Settings,
    db_connection: AsyncConnection,
    db_session: AsyncSession,
    api_settings: dict[str, Any],
    fake_clock: FakeClock,
) -> AsyncIterator[Api]:
    """The real application on real PostgreSQL and Redis. Each request gets its own session,
    exactly as in production, but all of them live in the test's rolled-back transaction."""
    settings = make_settings(
        database_url=migrated_database.database_url.unicode_string(),
        redis_url=migrated_database.redis_url.unicode_string(),
        **api_settings,
    )
    app = create_app(settings)

    async def request_session() -> AsyncIterator[AsyncSession]:
        session = _session_on(db_connection)
        try:
            yield session
        finally:
            await session.close()

    app.dependency_overrides[get_session] = request_session
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        from app.services.access import sync_access_catalog

        await sync_access_catalog(db_session)
        await db_session.commit()
        yield Api(client=client, app=app, settings=settings, session=db_session)
