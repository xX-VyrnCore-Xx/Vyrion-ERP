import pytest
from httpx import AsyncClient

from app import __version__
from app.main import create_app
from tests.conftest import make_settings


async def test_live_does_not_depend_on_services(offline_client: AsyncClient) -> None:
    response = await offline_client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


async def test_ready_reports_unreachable_services(offline_client: AsyncClient) -> None:
    response = await offline_client.get("/api/v1/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["components"]["database"] == {"status": "error", "latency_ms": None}
    assert body["components"]["redis"] == {"status": "error", "latency_ms": None}
    # Connection details must never reach the client.
    assert "127.0.0.1" not in response.text


async def test_cors_allows_desktop_origin_only(offline_client: AsyncClient) -> None:
    allowed = await offline_client.get(
        "/api/v1/health/live", headers={"Origin": "tauri://localhost"}
    )
    assert allowed.headers["access-control-allow-origin"] == "tauri://localhost"
    denied = await offline_client.get(
        "/api/v1/health/live", headers={"Origin": "https://evil.example"}
    )
    assert "access-control-allow-origin" not in denied.headers


def test_api_docs_disabled_in_production() -> None:
    settings = make_settings(environment="production", argon2_memory_kib=65_536, argon2_time_cost=3)
    app = create_app(settings)
    assert app.docs_url is None
    assert app.openapi_url is None


@pytest.mark.integration
async def test_ready_with_real_services(live_client: AsyncClient) -> None:
    response = await live_client.get("/api/v1/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["components"]["database"]["status"] == "ok"
    assert body["components"]["redis"]["status"] == "ok"
