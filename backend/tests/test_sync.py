"""Synchronisation rules: idempotency, versions, merging, conflicts, financial records."""

import uuid
from typing import Any

import pytest
from httpx import Response

from app.core.ids import uuid7
from tests.conftest import Api
from tests.helpers import BASE, bearer, login, make_user

pytestmark = pytest.mark.integration

DEVICE_A = uuid.UUID("018f0000-0000-7000-8000-00000000000a")
DEVICE_B = uuid.UUID("018f0000-0000-7000-8000-00000000000b")


async def _tokens(api: Api) -> dict[str, Any]:
    await make_user(api, "sync@example.com", roles=["employee"])
    return await login(api, "sync@example.com")


def _op(
    kind: str,
    entity: str,
    entity_id: uuid.UUID,
    base: int,
    payload: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "op_id": str(uuid7()),
        "entity": entity,
        "entity_id": str(entity_id),
        "kind": kind,
        "base_version": base,
        "payload": payload or {},
        **extra,
    }


async def _push(
    api: Api, tokens: dict[str, Any], device: uuid.UUID, *ops: dict[str, Any]
) -> Response:
    return await api.client.post(
        f"{BASE}/sync/push",
        json={"device_id": str(device), "operations": list(ops)},
        headers=bearer(tokens),
    )


async def _pull(
    api: Api, tokens: dict[str, Any], device: uuid.UUID, after: int = 0, limit: int = 200
) -> dict[str, Any]:
    response = await api.client.get(
        f"{BASE}/sync/pull",
        params={"device_id": str(device), "after": after, "limit": limit},
        headers=bearer(tokens),
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _first(response: Response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()["results"][0]
    return result


async def test_a_created_record_reaches_other_devices_but_not_the_sender(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    result = _first(
        await _push(api, tokens, DEVICE_A, _op("create", "party", rid, 0, {"name": "Acme"}))
    )
    assert result["status"] == "applied" and result["version"] == 1

    other = await _pull(api, tokens, DEVICE_B)
    assert [(c["entity"], c["entity_id"], c["version"], c["data"]) for c in other["changes"]] == [
        ("party", str(rid), 1, {"name": "Acme"})
    ]
    own = await _pull(api, tokens, DEVICE_A)
    assert own["changes"] == []
    assert own["cursor"] == other["cursor"] > 0  # the sender skips its own change but moves on


async def test_a_repeated_operation_is_applied_once(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    create = _op("create", "party", rid, 0, {"name": "Acme"})
    assert _first(await _push(api, tokens, DEVICE_A, create))["status"] == "applied"
    again = _first(await _push(api, tokens, DEVICE_A, create))
    assert again["status"] == "duplicate" and again["version"] == 1

    update = _op("update", "party", rid, 1, {"name": "Acme 2"})
    assert _first(await _push(api, tokens, DEVICE_A, update))["version"] == 2
    assert _first(await _push(api, tokens, DEVICE_A, update))["status"] == "duplicate"
    pulled = await _pull(api, tokens, DEVICE_B)
    assert pulled["changes"][0]["version"] == 2  # not 3


async def test_an_operation_id_cannot_be_reused_for_another_record(api: Api) -> None:
    tokens = await _tokens(api)
    first = _op("create", "party", uuid7(), 0, {"name": "A"})
    await _push(api, tokens, DEVICE_A, first)
    clash = {**first, "entity_id": str(uuid7())}
    assert _first(await _push(api, tokens, DEVICE_A, clash))["status"] == "rejected"


async def test_edits_to_different_fields_merge_and_everyone_downloads_the_result(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    await _push(
        api, tokens, DEVICE_A, _op("create", "party", rid, 0, {"name": "Acme", "phone": "1"})
    )
    await _push(api, tokens, DEVICE_B, _op("update", "party", rid, 1, {"phone": "2"}))
    merged = _first(
        await _push(api, tokens, DEVICE_A, _op("update", "party", rid, 1, {"name": "Acme Srl"}))
    )
    assert merged["status"] == "merged" and merged["version"] == 3

    for device in (DEVICE_A, DEVICE_B):  # a merge matches nobody's copy, so both pull it
        change = (await _pull(api, tokens, device))["changes"][0]
        assert change["data"] == {"name": "Acme Srl", "phone": "2"} and change["version"] == 3


async def test_updated_at_alone_never_conflicts(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    await _push(api, tokens, DEVICE_A, _op("create", "party", rid, 0, {"name": "A", "phone": "1"}))
    await _push(
        api, tokens, DEVICE_B, _op("update", "party", rid, 1, {"phone": "2", "updated_at": "t1"})
    )
    result = _first(
        await _push(
            api, tokens, DEVICE_A, _op("update", "party", rid, 1, {"name": "B", "updated_at": "t2"})
        )
    )
    assert result["status"] == "merged"


async def test_edits_to_the_same_field_conflict_and_show_the_server_copy(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    await _push(api, tokens, DEVICE_A, _op("create", "party", rid, 0, {"name": "Acme"}))
    await _push(api, tokens, DEVICE_B, _op("update", "party", rid, 1, {"name": "Beta"}))
    result = _first(
        await _push(api, tokens, DEVICE_A, _op("update", "party", rid, 1, {"name": "Gamma"}))
    )
    assert result["status"] == "conflict" and result["reason"] == "same_fields_changed"
    assert result["conflicting_fields"] == ["name"]
    assert result["server"]["version"] == 2 and result["server"]["data"]["name"] == "Beta"


@pytest.mark.parametrize("entity", ["document", "payment", "journal_entry", "stock_movement"])
async def test_financial_records_never_merge(api: Api, entity: str) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    await _push(api, tokens, DEVICE_A, _op("create", entity, rid, 0, {"a": 1, "b": 1}))
    await _push(api, tokens, DEVICE_B, _op("update", entity, rid, 1, {"a": 2}))
    result = _first(await _push(api, tokens, DEVICE_A, _op("update", entity, rid, 1, {"b": 2})))
    assert result["status"] == "conflict" and result["reason"] == "financial_record_changed"


async def test_delete_rules(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    await _push(api, tokens, DEVICE_A, _op("create", "task", rid, 0, {"title": "x"}))
    await _push(api, tokens, DEVICE_B, _op("update", "task", rid, 1, {"title": "y"}))
    # never delete over edits the sender has not seen
    blocked = _first(await _push(api, tokens, DEVICE_A, _op("delete", "task", rid, 1)))
    assert blocked["status"] == "conflict" and blocked["reason"] == "changed_since"
    ok = _first(await _push(api, tokens, DEVICE_A, _op("delete", "task", rid, 2)))
    assert ok["status"] == "applied" and ok["version"] == 3
    # deleted twice reaches the same goal
    assert (
        _first(await _push(api, tokens, DEVICE_B, _op("delete", "task", rid, 2)))["status"]
        == "applied"
    )
    # editing a deleted record is a conflict
    assert (
        _first(await _push(api, tokens, DEVICE_B, _op("update", "task", rid, 3, {"title": "z"})))[
            "reason"
        ]
        == "deleted"
    )
    gone = (await _pull(api, tokens, DEVICE_B, after=0))["changes"][0]
    assert gone["deleted"] is True


async def test_missing_future_and_duplicate_creates(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    assert (
        _first(await _push(api, tokens, DEVICE_A, _op("update", "party", rid, 1, {"name": "x"})))[
            "reason"
        ]
        == "missing"
    )
    await _push(api, tokens, DEVICE_A, _op("create", "party", rid, 0, {"name": "x"}))
    assert (
        _first(await _push(api, tokens, DEVICE_A, _op("update", "party", rid, 5, {"name": "y"})))[
            "status"
        ]
        == "rejected"
    )
    assert (
        _first(await _push(api, tokens, DEVICE_B, _op("create", "party", rid, 0, {"name": "z"})))[
            "reason"
        ]
        == "already_exists"
    )


async def test_the_first_connection_keeps_the_versions_records_already_have(api: Api) -> None:
    tokens = await _tokens(api)
    rid = uuid7()
    adopted = _first(
        await _push(
            api, tokens, DEVICE_A, _op("create", "party", rid, 0, {"name": "Old"}, version=7)
        )
    )
    assert adopted["version"] == 7
    assert (
        _first(await _push(api, tokens, DEVICE_A, _op("update", "party", rid, 7, {"name": "New"})))[
            "version"
        ]
        == 8
    )


async def test_one_bad_operation_does_not_stop_the_batch(api: Api) -> None:
    tokens = await _tokens(api)
    good = uuid7()
    response = await _push(
        api,
        tokens,
        DEVICE_A,
        _op("update", "party", uuid7(), 1, {"name": "nobody"}),
        _op("create", "party", good, 0, {"name": "fine"}),
    )
    statuses = [r["status"] for r in response.json()["results"]]
    assert statuses == ["conflict", "applied"]


@pytest.mark.parametrize(
    "bad",
    [
        _op("create", "Party", uuid7(), 0, {"name": "x"}),  # upper case entity
        _op("create", "party", uuid7(), 3, {"name": "x"}),  # create must start at 0
        _op("update", "party", uuid7(), 0, {"name": "x"}),  # update needs a base version
        _op("update", "party", uuid7(), 1, {}),  # update needs fields
        _op("delete", "party", uuid7(), 1, {"name": "x"}),  # delete carries nothing
        _op("create", "party", uuid7(), 0, {"version": 9}),  # protocol columns are reserved
        _op("create", "party", uuid7(), 0, {"Name; DROP": 1}),  # field names are validated
    ],
)
async def test_malformed_operations_are_refused(api: Api, bad: dict[str, Any]) -> None:
    tokens = await _tokens(api)
    assert (await _push(api, tokens, DEVICE_A, bad)).status_code == 422


async def test_pull_pages_through_changes(api: Api) -> None:
    tokens = await _tokens(api)
    ids = [uuid7() for _ in range(5)]
    await _push(
        api, tokens, DEVICE_A, *[_op("create", "task", i, 0, {"n": n}) for n, i in enumerate(ids)]
    )
    first = await _pull(api, tokens, DEVICE_B, limit=2)
    assert len(first["changes"]) == 2 and first["has_more"] is True
    second = await _pull(api, tokens, DEVICE_B, after=first["cursor"], limit=2)
    third = await _pull(api, tokens, DEVICE_B, after=second["cursor"], limit=2)
    seen = [c["entity_id"] for page in (first, second, third) for c in page["changes"]]
    assert seen == [str(i) for i in ids] and third["has_more"] is False
    assert (await _pull(api, tokens, DEVICE_B, after=third["cursor"]))["changes"] == []


async def test_the_change_log_cannot_be_rewritten(api: Api) -> None:
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    tokens = await _tokens(api)
    await _push(api, tokens, DEVICE_A, _op("create", "party", uuid7(), 0, {"name": "x"}))
    with pytest.raises(DBAPIError):
        await api.session.execute(text("UPDATE sync_changes SET entity = 'other'"))
    await api.session.rollback()
