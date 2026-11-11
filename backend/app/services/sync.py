"""Synchronisation between the desktop apps and the server.

Rules, in one place:

* Every operation carries the version of the record it was based on.
* The same version → applied. An older version → the fields it touches are compared with
  what changed since: no overlap merges automatically, overlap is a conflict.
* **Financial records never merge automatically** (documents, payments, journal, stock): any
  version difference is a conflict a person must resolve. Issued documents are immutable
  on the device, so they only ever arrive as creates.
* ``op_id`` makes a retry harmless: a repeated operation returns its original outcome.
"""

import uuid
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sync import SyncChange, SyncRecord
from app.schemas.sync import (
    OperationResult,
    PullChange,
    PullResponse,
    PushResponse,
    ServerRecord,
    SyncOperation,
)

# Entities that must never be merged automatically. They match the desktop modules.
FINANCIAL_ENTITIES = frozenset(
    {
        "document",
        "document_line",
        "payment",
        "journal_entry",
        "journal_line",
        "stock_movement",
    }
)

# Bookkeeping that every edit changes: two devices editing different fields still merge.
NEVER_CONFLICTS = frozenset({"updated_at"})

# Pushes are applied one at a time, so commit order equals sequence order and a puller's
# cursor can never skip a change that commits late.
_PUSH_LOCK = 7_342_001


def _server_record(record: SyncRecord) -> ServerRecord:
    return ServerRecord(
        entity=record.entity,
        entity_id=record.entity_id,
        version=record.version,
        deleted=record.deleted,
        data=record.data,
    )


def _conflict(
    op: SyncOperation,
    reason: str,
    record: SyncRecord | None,
    fields: list[str] | None = None,
) -> OperationResult:
    return OperationResult(
        op_id=op.op_id,
        status="conflict",
        reason=reason,
        conflicting_fields=sorted(fields or []),
        server=_server_record(record) if record else None,
    )


async def push(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    operations: list[SyncOperation],
) -> PushResponse:
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _PUSH_LOCK})
    results: list[OperationResult] = []
    for op in operations:
        # A savepoint per operation: one that fails leaves the others untouched.
        async with session.begin_nested():
            results.append(await _apply(session, user_id, device_id, op))
    return PushResponse(results=results)


async def _apply(
    session: AsyncSession, user_id: uuid.UUID, device_id: uuid.UUID, op: SyncOperation
) -> OperationResult:
    seen = (
        await session.execute(select(SyncChange).where(SyncChange.op_id == op.op_id))
    ).scalar_one_or_none()
    if seen is not None:
        if (seen.entity, seen.entity_id) != (op.entity, op.entity_id):
            return OperationResult(
                op_id=op.op_id, status="rejected", reason="operation id already used"
            )
        return OperationResult(op_id=op.op_id, status="duplicate", version=seen.new_version)

    record = (
        await session.execute(
            select(SyncRecord)
            .where(SyncRecord.entity == op.entity, SyncRecord.entity_id == op.entity_id)
            .with_for_update()
        )
    ).scalar_one_or_none()

    if op.kind == "create":
        return await _create(session, user_id, device_id, op, record)
    if record is None:
        return _conflict(op, "missing", None)
    if op.kind == "update":
        return await _update(session, user_id, device_id, op, record)
    return await _delete(session, user_id, device_id, op, record)


async def _log(
    session: AsyncSession,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    op: SyncOperation,
    new_version: int,
    fields: dict[str, Any],
) -> int:
    change = SyncChange(
        op_id=op.op_id,
        device_id=device_id,
        user_id=user_id,
        entity=op.entity,
        entity_id=op.entity_id,
        kind=op.kind,
        base_version=op.base_version,
        new_version=new_version,
        fields=fields,
    )
    session.add(change)
    await session.flush()
    return change.seq


async def _create(
    session: AsyncSession,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    op: SyncOperation,
    record: SyncRecord | None,
) -> OperationResult:
    if record is not None:
        return _conflict(op, "already_exists", record)
    seq = await _log(session, user_id, device_id, op, op.version, op.payload)
    session.add(
        SyncRecord(
            entity=op.entity,
            entity_id=op.entity_id,
            version=op.version,
            data=op.payload,
            deleted=False,
            last_seq=seq,
            last_device_id=device_id,
        )
    )
    return OperationResult(op_id=op.op_id, status="applied", version=op.version)


async def _update(
    session: AsyncSession,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    op: SyncOperation,
    record: SyncRecord,
) -> OperationResult:
    if record.deleted:
        return _conflict(op, "deleted", record)
    if op.base_version > record.version:
        return OperationResult(
            op_id=op.op_id, status="rejected", reason="based on a version the server has not seen"
        )
    merged = False
    if op.base_version < record.version:
        if op.entity in FINANCIAL_ENTITIES:
            return _conflict(op, "financial_record_changed", record)
        touched = await _fields_changed_since(session, op, op.base_version)
        overlap = sorted((set(op.payload) & touched) - NEVER_CONFLICTS)
        if overlap:
            return _conflict(op, "same_fields_changed", record, overlap)
        merged = True

    new_version = record.version + 1
    seq = await _log(session, user_id, device_id, op, new_version, op.payload)
    record.data = {**record.data, **op.payload}
    record.version = new_version
    record.last_seq = seq
    record.last_device_id = None if merged else device_id
    return OperationResult(
        op_id=op.op_id, status="merged" if merged else "applied", version=new_version
    )


async def _delete(
    session: AsyncSession,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    op: SyncOperation,
    record: SyncRecord,
) -> OperationResult:
    if record.deleted:
        # Somebody already deleted it: the outcome the sender wants is reached.
        return OperationResult(op_id=op.op_id, status="applied", version=record.version)
    if op.base_version != record.version:
        # Never delete over edits the sender has not seen.
        return _conflict(op, "changed_since", record)
    new_version = record.version + 1
    seq = await _log(session, user_id, device_id, op, new_version, {})
    record.deleted = True
    record.version = new_version
    record.last_seq = seq
    record.last_device_id = device_id
    return OperationResult(op_id=op.op_id, status="applied", version=new_version)


async def _fields_changed_since(session: AsyncSession, op: SyncOperation, version: int) -> set[str]:
    rows = (
        await session.execute(
            select(SyncChange.fields).where(
                SyncChange.entity == op.entity,
                SyncChange.entity_id == op.entity_id,
                SyncChange.new_version > version,
                SyncChange.kind == "update",
            )
        )
    ).scalars()
    return {name for fields in rows for name in fields}


async def pull(
    session: AsyncSession, *, device_id: uuid.UUID, after: int, limit: int
) -> PullResponse:
    """Records changed by other devices (or merged) after ``after``, oldest first.

    Each record is returned once, in its latest state, not as a replay of its history.
    """
    rows = list(
        (
            await session.execute(
                select(SyncRecord)
                .where(
                    SyncRecord.last_seq > after,
                    (SyncRecord.last_device_id.is_(None))
                    | (SyncRecord.last_device_id != device_id),
                )
                .order_by(SyncRecord.last_seq)
                .limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    has_more = len(rows) > limit
    page = rows[:limit]
    if has_more:
        cursor = page[-1].last_seq
    else:
        # Nothing more for this device: skip over the changes it made itself too.
        newest = (await session.execute(select(func.max(SyncRecord.last_seq)))).scalar_one()
        cursor = max(after, int(newest or 0))
    return PullResponse(
        changes=[
            PullChange(
                seq=r.last_seq,
                entity=r.entity,
                entity_id=r.entity_id,
                version=r.version,
                deleted=r.deleted,
                data=r.data,
            )
            for r in page
        ],
        cursor=cursor,
        has_more=has_more,
        server_time=(await session.execute(select(func.now()))).scalar_one(),
    )
