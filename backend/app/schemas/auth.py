import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, IPvAnyAddress, StringConstraints

from app.schemas.access import UserRead

# Bounded so that nobody can make the server hash or compare megabytes of input.
Password = Annotated[str, StringConstraints(min_length=1, max_length=1024)]
Token = Annotated[str, StringConstraints(min_length=10, max_length=256)]
Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=6, max_length=32)]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
    password: Password


class TokenResponse(BaseModel):
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105  (a scheme name, not a secret)
    session_id: uuid.UUID
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime


class SecondFactorChallenge(BaseModel):
    challenge_token: str
    expires_at: datetime


class LoginResponse(BaseModel):
    """Exactly one of ``tokens`` and ``second_factor`` is set."""

    status: Literal["authenticated", "second_factor_required"]
    tokens: TokenResponse | None = None
    second_factor: SecondFactorChallenge | None = None


class SecondFactorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    challenge_token: Token
    code: Code


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: Token


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: Password
    new_password: Password


class PasswordSetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: Token
    new_password: Password


class TotpSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class TotpEnableRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Code


class TotpDisableRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: Password
    code: Code


class RecoveryCodesRequest(BaseModel):
    """New recovery codes: the same proof as switching 2FA off (password and a current code)."""

    model_config = ConfigDict(extra="forbid")

    password: Password
    code: Code


class RecoveryCodesResponse(BaseModel):
    recovery_codes: list[str]


class MeResponse(BaseModel):
    user: UserRead
    permissions: list[str]
    session_id: uuid.UUID
    mfa_verified: bool
    # True when the server requires 2FA for administrators and this account has not set it up.
    second_factor_required: bool = False


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    last_used_at: datetime
    ip_address: IPvAnyAddress | None
    user_agent: str | None
    mfa_verified: bool
    current: bool = False


class LoginEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    occurred_at: datetime
    success: bool
    failure_reason: str | None
    ip_address: IPvAnyAddress | None
    user_agent: str | None


class RevokedResponse(BaseModel):
    sessions_revoked: int


class SetupTokenResponse(BaseModel):
    """Shown once. Hand it to the user over a trusted channel; it is not stored in clear."""

    setup_token: str
    expires_at: datetime


class InvitationResponse(SetupTokenResponse):
    user: UserRead


class VersionedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Annotated[int, Field(ge=1)]


class RolesAssignRequest(VersionedRequest):
    roles: set[str]


class PermissionsAssignRequest(VersionedRequest):
    permissions: set[str]
