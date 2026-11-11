import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ENTITY = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
FIELD = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
# Columns every record has; they belong to the sync protocol, not to the payload.
RESERVED_FIELDS = frozenset({"id", "version", "deleted_at"})
MAX_OPERATIONS = 200
MAX_RECORD_FIELDS = 200


class SyncOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op_id: uuid.UUID
    entity: str
    entity_id: uuid.UUID
    kind: Literal["create", "update", "delete"]
    base_version: Annotated[int, Field(ge=0)]
    # Only for a create: the version the record already has on the device. When an app
    # is linked to a server for the first time its existing records keep their versions.
    version: Annotated[int, Field(ge=1)] = 1
    # create: the whole record; update: only the changed fields; delete: empty.
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("entity")
    @classmethod
    def _entity(cls, value: str) -> str:
        if not ENTITY.fullmatch(value):
            raise ValueError("invalid entity name")
        return value

    @model_validator(mode="after")
    def _shape(self) -> "SyncOperation":
        if len(self.payload) > MAX_RECORD_FIELDS:
            raise ValueError("too many fields")
        for name in self.payload:
            if not FIELD.fullmatch(name):
                raise ValueError(f"invalid field name: {name}")
            if name in RESERVED_FIELDS:
                raise ValueError(f"{name} is managed by the protocol")
        if self.kind == "create" and self.base_version != 0:
            raise ValueError("a create starts from version 0")
        if self.kind != "create" and self.base_version < 1:
            raise ValueError("this operation needs the version it is based on")
        if self.kind == "update" and not self.payload:
            raise ValueError("an update needs at least one field")
        if self.kind == "delete" and self.payload:
            raise ValueError("a delete carries no fields")
        return self


class PushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: uuid.UUID
    operations: Annotated[list[SyncOperation], Field(min_length=1, max_length=MAX_OPERATIONS)]


class ServerRecord(BaseModel):
    entity: str
    entity_id: uuid.UUID
    version: int
    deleted: bool
    data: dict[str, Any]


class OperationResult(BaseModel):
    op_id: uuid.UUID
    status: Literal["applied", "merged", "duplicate", "conflict", "rejected"]
    # applied/merged/duplicate: the version the server record has after the operation.
    version: int | None = None
    # conflict: why, and what the server holds now so the person can choose.
    reason: str | None = None
    conflicting_fields: list[str] = Field(default_factory=list)
    server: ServerRecord | None = None


class PushResponse(BaseModel):
    results: list[OperationResult]


class PullChange(BaseModel):
    seq: int
    entity: str
    entity_id: uuid.UUID
    version: int
    deleted: bool
    data: dict[str, Any]


class PullResponse(BaseModel):
    changes: list[PullChange]
    # Pass this back as `after` for the next page; equal to `after` when nothing is new.
    cursor: int
    has_more: bool
    server_time: datetime
