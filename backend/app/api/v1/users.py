"""User administration. Every route names the permission it needs; guard rules that depend
on *who* is acting and *whom* they act on live in ``app.services.user_admin``."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AuthServiceDep, SessionDep, require
from app.schemas.access import UserCreate, UserRead, UserUpdate
from app.schemas.auth import (
    InvitationResponse,
    PermissionsAssignRequest,
    RevokedResponse,
    RolesAssignRequest,
    SetupTokenResponse,
)
from app.schemas.common import PageResponse
from app.services import user_admin, users
from app.services.authz import AuthContext

router = APIRouter(prefix="/users", tags=["users"])

ViewUsers = Annotated[AuthContext, Depends(require("core.users:view"))]
CreateUsers = Annotated[AuthContext, Depends(require("core.users:create"))]
UpdateUsers = Annotated[AuthContext, Depends(require("core.users:update"))]
DeleteUsers = Annotated[AuthContext, Depends(require("core.users:delete"))]
AdminUsers = Annotated[AuthContext, Depends(require("core.users:admin"))]


class UserPatch(UserUpdate):
    version: int


@router.get("", response_model=PageResponse[UserRead])
async def list_users(
    _: ViewUsers,
    session: SessionDep,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    cursor: str | None = None,
) -> PageResponse[UserRead]:
    page = await users.list_users(session, limit=limit, cursor=cursor)
    return PageResponse(
        items=[UserRead.model_validate(user) for user in page.items], next_cursor=page.next_cursor
    )


@router.post("", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate, actor: CreateUsers, session: SessionDep, auth: AuthServiceDep
) -> InvitationResponse:
    """Creates the account without a password and returns a one-time setup token."""
    user, token, expires = await user_admin.invite_user(session, auth, actor, body)
    await session.commit()
    return InvitationResponse(
        user=UserRead.model_validate(user), setup_token=token, expires_at=expires
    )


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: uuid.UUID, _: ViewUsers, session: SessionDep) -> UserRead:
    return UserRead.model_validate(await users.get_user(session, user_id))


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID,
    body: UserPatch,
    actor: UpdateUsers,
    session: SessionDep,
    auth: AuthServiceDep,
) -> UserRead:
    changes = UserUpdate.model_validate(body.model_dump(exclude={"version"}, exclude_unset=True))
    user = await user_admin.update_user(
        session, auth, actor, user_id, changes, expected_version=body.version
    )
    await session.commit()
    return UserRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    version: Annotated[int, Query(ge=1)],
    actor: DeleteUsers,
    session: SessionDep,
    auth: AuthServiceDep,
) -> None:
    await user_admin.delete_user(session, auth, actor, user_id, expected_version=version)
    await session.commit()


@router.put("/{user_id}/roles", response_model=UserRead)
async def set_roles(
    user_id: uuid.UUID,
    body: RolesAssignRequest,
    actor: AdminUsers,
    session: SessionDep,
    auth: AuthServiceDep,
) -> UserRead:
    user = await user_admin.assign_roles(
        session, auth, actor, user_id, body.roles, expected_version=body.version
    )
    await session.commit()
    return UserRead.model_validate(user)


@router.put("/{user_id}/permissions", response_model=UserRead)
async def set_permissions(
    user_id: uuid.UUID, body: PermissionsAssignRequest, actor: AdminUsers, session: SessionDep
) -> UserRead:
    user = await user_admin.assign_permissions(
        session, actor, user_id, body.permissions, expected_version=body.version
    )
    await session.commit()
    return UserRead.model_validate(user)


@router.post("/{user_id}/revoke-sessions", response_model=RevokedResponse)
async def revoke_sessions(
    user_id: uuid.UUID, actor: AdminUsers, session: SessionDep, auth: AuthServiceDep
) -> RevokedResponse:
    """Disconnect the user from every device."""
    revoked = await user_admin.revoke_user_sessions(session, auth, actor, user_id)
    await session.commit()
    return RevokedResponse(sessions_revoked=revoked)


@router.post("/{user_id}/password-reset", response_model=SetupTokenResponse)
async def password_reset(
    user_id: uuid.UUID, actor: AdminUsers, session: SessionDep, auth: AuthServiceDep
) -> SetupTokenResponse:
    token, expires = await user_admin.issue_password_reset(session, auth, actor, user_id)
    await session.commit()
    return SetupTokenResponse(setup_token=token, expires_at=expires)


@router.post("/{user_id}/2fa/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_two_factor(
    user_id: uuid.UUID, actor: AdminUsers, session: SessionDep, auth: AuthServiceDep
) -> None:
    await user_admin.reset_two_factor(session, auth, actor, user_id)
    await session.commit()
