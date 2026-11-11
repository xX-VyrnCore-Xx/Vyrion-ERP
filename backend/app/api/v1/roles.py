import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep, require
from app.core.permissions import CATALOG
from app.schemas.access import PermissionRead, RoleCreate, RoleRead
from app.schemas.auth import PermissionsAssignRequest
from app.services import access
from app.services.authz import AuthContext, ensure_can_grant

router = APIRouter(prefix="/roles", tags=["roles"])

ViewRoles = Annotated[AuthContext, Depends(require("core.roles:view"))]
CreateRoles = Annotated[AuthContext, Depends(require("core.roles:create"))]
UpdateRoles = Annotated[AuthContext, Depends(require("core.roles:update"))]
DeleteRoles = Annotated[AuthContext, Depends(require("core.roles:delete"))]


@router.get("", response_model=list[RoleRead])
async def list_roles(_: ViewRoles, session: SessionDep) -> list[RoleRead]:
    return [RoleRead.model_validate(role) for role in await access.list_roles(session)]


@router.get("/permissions", response_model=list[PermissionRead])
async def permission_catalog(_: ViewRoles) -> list[PermissionRead]:
    """Every permission that can be granted, straight from the code-defined catalog."""
    return [
        PermissionRead(
            key=item.key,
            module=item.module,
            resource=item.resource,
            action=item.action.value,
            description=item.description,
        )
        for item in sorted(CATALOG, key=lambda item: item.key)
    ]


@router.get("/{role_id}", response_model=RoleRead)
async def get_role(role_id: uuid.UUID, _: ViewRoles, session: SessionDep) -> RoleRead:
    return RoleRead.model_validate(await access.get_role(session, role_id))


@router.post("", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
async def create_role(body: RoleCreate, actor: CreateRoles, session: SessionDep) -> RoleRead:
    ensure_can_grant(actor, permission_keys=body.permissions)
    role = await access.create_role(session, body, actor.audit())
    await session.commit()
    return RoleRead.model_validate(role)


@router.put("/{role_id}/permissions", response_model=RoleRead)
async def set_role_permissions(
    role_id: uuid.UUID, body: PermissionsAssignRequest, actor: UpdateRoles, session: SessionDep
) -> RoleRead:
    current = await access.get_role(session, role_id)
    already = {permission.key for permission in current.permissions}
    ensure_can_grant(actor, permission_keys=body.permissions - already)
    role = await access.set_role_permissions(
        session, role_id, body.permissions, actor.audit(), expected_version=body.version
    )
    await session.commit()
    return RoleRead.model_validate(role)


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: uuid.UUID,
    version: Annotated[int, Query(ge=1)],
    actor: DeleteRoles,
    session: SessionDep,
) -> None:
    await access.delete_role(session, role_id, actor.audit(), expected_version=version)
    await session.commit()
