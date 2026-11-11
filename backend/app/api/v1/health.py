"""Liveness and readiness probes.

* ``/live``  — the process is up; never touches dependencies.
* ``/ready`` — PostgreSQL and Redis are actually reachable. The desktop client
  uses it to decide whether the server (and therefore the VPN) is available.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from app import __version__

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/health", tags=["health"])


class LiveResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str


class ComponentStatus(BaseModel):
    status: Literal["ok", "error"]
    latency_ms: float | None = None


class ReadyResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    components: dict[str, ComponentStatus]


async def _probe(name: str, check: Callable[[], Awaitable[None]], limit: float) -> ComponentStatus:
    started = time.perf_counter()
    try:
        async with asyncio.timeout(limit):
            await check()
    except Exception:
        # Details stay in the server log: the response must not leak internals.
        logger.exception("health probe failed: %s", name)
        return ComponentStatus(status="error")
    return ComponentStatus(status="ok", latency_ms=round((time.perf_counter() - started) * 1000, 2))


@router.get("/live", response_model=LiveResponse)
async def live() -> LiveResponse:
    return LiveResponse(version=__version__)


@router.get(
    "/ready",
    response_model=ReadyResponse,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ReadyResponse}},
)
async def ready(request: Request, response: Response) -> ReadyResponse:
    state = request.app.state
    limit: float = state.settings.health_check_timeout

    async def check_database() -> None:
        async with state.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))

    async def check_redis() -> None:
        await state.redis.ping()

    database, redis = await asyncio.gather(
        _probe("database", check_database, limit),
        _probe("redis", check_redis, limit),
    )
    components = {"database": database, "redis": redis}
    healthy = all(component.status == "ok" for component in components.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadyResponse(
        status="ok" if healthy else "degraded",
        version=__version__,
        components=components,
    )
