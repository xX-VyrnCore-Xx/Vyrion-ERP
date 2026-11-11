import time
import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel

from app.core.errors import InvalidInputError, VersionConflictError, register_error_handlers
from app.core.ids import uuid7
from app.core.italy import is_personal_fiscal_code_format, is_valid_partita_iva
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from app.core.permissions import CATALOG, CATALOG_KEYS, SYSTEM_ROLES


def test_uuid7_layout() -> None:
    value = uuid7()
    assert value.version == 7
    assert value.variant == uuid.RFC_4122
    embedded_ms = value.int >> 80
    assert abs(embedded_ms - time.time_ns() // 1_000_000) < 5_000


def test_uuid7_is_time_ordered_and_unique() -> None:
    first = uuid7()
    time.sleep(0.002)
    second = uuid7()
    assert first < second
    assert len({uuid7() for _ in range(2_000)}) == 2_000


def test_cursor_roundtrip() -> None:
    value = uuid7()
    assert decode_cursor(encode_cursor(value)) == value


@pytest.mark.parametrize("cursor", ["", "abc", "not base64 !!", "A" * 40])
def test_invalid_cursor_rejected(cursor: str) -> None:
    with pytest.raises(InvalidInputError):
        decode_cursor(cursor)


def test_clamp_limit() -> None:
    assert clamp_limit(None) == DEFAULT_LIMIT
    assert clamp_limit(10) == 10
    assert clamp_limit(10_000) == MAX_LIMIT
    with pytest.raises(InvalidInputError):
        clamp_limit(0)


@pytest.mark.parametrize("value", ["12345678903", "00000000018"])
def test_valid_partita_iva(value: str) -> None:
    assert is_valid_partita_iva(value)


@pytest.mark.parametrize(
    "value",
    ["12345678901", "1234567890", "123456789033", "1234567890A", "00000000000", "", " 12345678903"],
)
def test_invalid_partita_iva(value: str) -> None:
    assert not is_valid_partita_iva(value)


def test_personal_fiscal_code_format() -> None:
    assert is_personal_fiscal_code_format("RSSMRA80A01H501U")
    assert is_personal_fiscal_code_format("RSSMRA80A01H50MU")  # omocodia
    assert not is_personal_fiscal_code_format("RSSMRA80A01H501")
    assert not is_personal_fiscal_code_format("rssmra80a01h501u")
    assert not is_personal_fiscal_code_format("12345678903")


def test_permission_catalog_is_consistent() -> None:
    assert len(CATALOG_KEYS) == len(CATALOG), "duplicate permission keys"
    for role in SYSTEM_ROLES:
        assert role.permissions <= CATALOG_KEYS, f"{role.key} grants unknown permissions"
    assert len({role.key for role in SYSTEM_ROLES}) == len(SYSTEM_ROLES)


class _Payload(BaseModel):
    amount: int


def _error_app() -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/conflict")
    async def conflict() -> None:
        raise VersionConflictError("stale", details={"current_version": 3})

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    @app.post("/payload")
    async def payload(body: _Payload) -> _Payload:
        return body

    return app


@pytest.fixture
async def error_client() -> AsyncClient:
    transport = ASGITransport(app=_error_app(), raise_app_exceptions=False)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_app_error_envelope(error_client: AsyncClient) -> None:
    response = await error_client.get("/conflict")
    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "version_conflict",
            "message": "stale",
            "details": {"current_version": 3},
        }
    }


async def test_unknown_route_uses_the_envelope(error_client: AsyncClient) -> None:
    response = await error_client.get("/missing")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def test_validation_error_does_not_echo_input(error_client: AsyncClient) -> None:
    response = await error_client.post("/payload", json={"amount": "sensitive-value"})
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_input"
    assert body["error"]["details"]["fields"][0]["loc"] == ["body", "amount"]
    assert "sensitive-value" not in response.text


async def test_unexpected_error_hides_details(error_client: AsyncClient) -> None:
    response = await error_client.get("/boom")
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Internal server error", "details": {}}
    }
    assert "secret" not in response.text
