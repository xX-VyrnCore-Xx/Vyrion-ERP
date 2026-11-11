import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, StringConstraints, field_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
RoleKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,62}[a-z0-9]$")]
RoleName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


def _normalise_email(value: str) -> str:
    return value.strip().lower()


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    full_name: Name

    _lower_email = field_validator("email", mode="after")(_normalise_email)


class UserUpdate(BaseModel):
    """Partial update: only the fields that are sent are changed."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr | None = None
    full_name: Name | None = None
    is_active: bool | None = None

    @field_validator("email", mode="after")
    @classmethod
    def _lower_email(cls, value: str | None) -> str | None:
        return None if value is None else _normalise_email(value)


class PermissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    module: str
    resource: str
    action: str
    description: str


class RoleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    is_system: bool


class RoleRead(RoleSummary):
    version: int
    description: str
    permissions: list[PermissionRead]


class RoleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: RoleKey
    name: RoleName
    description: Annotated[str, StringConstraints(max_length=1000)] = ""
    permissions: set[str] = set()


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    email: str
    full_name: str
    is_active: bool
    roles: list[RoleSummary]
    created_at: datetime
    updated_at: datetime
