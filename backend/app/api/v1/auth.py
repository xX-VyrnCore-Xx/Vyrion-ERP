"""Sign-in, sessions, passwords and two-factor authentication.

Public routes (no bearer token): login, second-factor completion, refresh, and setting a
password with a one-time token. Everything else needs a valid session.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import (
    AuthServiceDep,
    ClientDep,
    CurrentContext,
    SessionDep,
)
from app.core.errors import NotFoundError
from app.schemas.access import UserRead
from app.schemas.auth import (
    LoginEventRead,
    LoginRequest,
    LoginResponse,
    MeResponse,
    PasswordChangeRequest,
    PasswordSetupRequest,
    RecoveryCodesResponse,
    RefreshRequest,
    RevokedResponse,
    SecondFactorChallenge,
    SecondFactorRequest,
    SessionRead,
    TokenResponse,
    TotpDisableRequest,
    TotpEnableRequest,
    TotpSetupResponse,
)
from app.services.auth import SecondFactorRequired, TokenPair

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens(pair: TokenPair) -> TokenResponse:
    return TokenResponse(
        session_id=pair.session_id,
        access_token=pair.access_token,
        access_expires_at=pair.access_expires_at,
        refresh_token=pair.refresh_token,
        refresh_expires_at=pair.refresh_expires_at,
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    session: SessionDep,
    auth: AuthServiceDep,
    client: ClientDep,
    response: Response,
) -> LoginResponse:
    response.headers["Cache-Control"] = "no-store"
    result = await auth.login(session, email=body.email, password=body.password, client=client)
    if isinstance(result, SecondFactorRequired):
        return LoginResponse(
            status="second_factor_required",
            second_factor=SecondFactorChallenge(
                challenge_token=result.challenge_token, expires_at=result.expires_at
            ),
        )
    return LoginResponse(status="authenticated", tokens=_tokens(result))


@router.post("/login/second-factor", response_model=TokenResponse)
async def login_second_factor(
    body: SecondFactorRequest,
    session: SessionDep,
    auth: AuthServiceDep,
    client: ClientDep,
    response: Response,
) -> TokenResponse:
    response.headers["Cache-Control"] = "no-store"
    pair = await auth.complete_second_factor(
        session, challenge_token=body.challenge_token, code=body.code, client=client
    )
    return _tokens(pair)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    session: SessionDep,
    auth: AuthServiceDep,
    client: ClientDep,
    response: Response,
) -> TokenResponse:
    response.headers["Cache-Control"] = "no-store"
    pair = await auth.refresh(session, refresh_token=body.refresh_token, client=client)
    await session.commit()
    return _tokens(pair)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(context: CurrentContext, session: SessionDep, auth: AuthServiceDep) -> None:
    await auth.revoke_session(
        session, session_id=context.session_id, user_id=context.user.id, reason="logout"
    )
    await session.commit()


@router.post("/logout-all", response_model=RevokedResponse)
async def logout_all(
    context: CurrentContext, session: SessionDep, auth: AuthServiceDep
) -> RevokedResponse:
    """Sign out of every device, this one included."""
    revoked = await auth.revoke_all_sessions(session, user_id=context.user.id, reason="logout_all")
    await session.commit()
    return RevokedResponse(sessions_revoked=revoked)


@router.get("/me", response_model=MeResponse)
async def me(context: CurrentContext) -> MeResponse:
    return MeResponse(
        user=UserRead.model_validate(context.user),
        permissions=sorted(context.permissions),
        session_id=context.session_id,
        mfa_verified=context.mfa_verified,
    )


@router.get("/sessions", response_model=list[SessionRead])
async def list_sessions(
    context: CurrentContext, session: SessionDep, auth: AuthServiceDep
) -> list[SessionRead]:
    rows = await auth.list_sessions(session, context.user.id)
    return [
        SessionRead.model_validate(row).model_copy(update={"current": row.id == context.session_id})
        for row in rows
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: uuid.UUID, context: CurrentContext, session: SessionDep, auth: AuthServiceDep
) -> None:
    revoked = await auth.revoke_session(
        session, session_id=session_id, user_id=context.user.id, reason="revoked_by_user"
    )
    if not revoked:
        raise NotFoundError("Session not found")
    await session.commit()


@router.get("/login-history", response_model=list[LoginEventRead])
async def login_history(
    context: CurrentContext,
    session: SessionDep,
    auth: AuthServiceDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[LoginEventRead]:
    rows = await auth.list_login_events(session, context.user.id, limit=limit)
    return [LoginEventRead.model_validate(row) for row in rows]


@router.post("/password/change", response_model=RevokedResponse)
async def change_password(
    body: PasswordChangeRequest, context: CurrentContext, session: SessionDep, auth: AuthServiceDep
) -> RevokedResponse:
    revoked = await auth.change_password(
        session,
        context=context,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    await session.commit()
    return RevokedResponse(sessions_revoked=revoked)


@router.post("/password/setup", status_code=status.HTTP_204_NO_CONTENT)
async def set_password(
    body: PasswordSetupRequest, session: SessionDep, auth: AuthServiceDep, client: ClientDep
) -> None:
    """Choose a password with the one-time token received from an administrator."""
    await auth.set_password_with_token(
        session, token=body.token, new_password=body.new_password, client=client
    )
    await session.commit()


@router.post("/2fa/setup", response_model=TotpSetupResponse)
async def totp_setup(
    context: CurrentContext, session: SessionDep, auth: AuthServiceDep, response: Response
) -> TotpSetupResponse:
    response.headers["Cache-Control"] = "no-store"
    setup = await auth.begin_totp_setup(session, user=context.user)
    await session.commit()
    return TotpSetupResponse(secret=setup.secret, otpauth_uri=setup.otpauth_uri)


@router.post("/2fa/enable", response_model=RecoveryCodesResponse)
async def totp_enable(
    body: TotpEnableRequest,
    context: CurrentContext,
    session: SessionDep,
    auth: AuthServiceDep,
    response: Response,
) -> RecoveryCodesResponse:
    response.headers["Cache-Control"] = "no-store"
    codes = await auth.enable_totp(session, context=context, code=body.code)
    await session.commit()
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def totp_disable(
    body: TotpDisableRequest, context: CurrentContext, session: SessionDep, auth: AuthServiceDep
) -> None:
    await auth.disable_totp(session, context=context, password=body.password, code=body.code)
    await session.commit()
