"""Roles and the permission catalog."""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import delete, literal, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ForbiddenError, InvalidInputError, NotFoundError
from app.core.ids import uuid7
from app.core.permissions import CATALOG, CATALOG_KEYS, SYSTEM_ROLE_KEYS, SYSTEM_ROLES
from app.models.access import Permission, Role, RolePermission, UserRole
from app.schemas.access import RoleCreate
from app.services import audit
from app.services.audit import AuditContext
from app.services.common import ensure_version, flush_versioned


async def sync_access_catalog(session: AsyncSession) -> None:
    """Mirror the code-defined permissions and system roles into the database.

    Idempotent and safe to run at every start. Permissions removed from the catalog
    are deleted together with their grants. System roles get exactly the permissions
    defined in code; custom roles are left untouched.

    It writes with plain SQL: run it in its own session (see ``app.cli``), because
    ORM objects loaded earlier in the same session are not refreshed.
    """
    for definition in CATALOG:
        statement = insert(Permission).values(
            id=uuid7(),
            key=definition.key,
            module=definition.module,
            resource=definition.resource,
            action=definition.action.value,
            description=definition.description,
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[Permission.key],
                set_={"description": statement.excluded.description},
            )
        )
    await session.execute(delete(Permission).where(Permission.key.not_in(CATALOG_KEYS)))

    for role_def in SYSTEM_ROLES:
        statement = insert(Role).values(
            id=uuid7(),
            key=role_def.key,
            name=role_def.name,
            description=role_def.description,
            is_system=True,
            version=1,
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[Role.key],
                set_={
                    "name": statement.excluded.name,
                    "description": statement.excluded.description,
                    "is_system": True,
                },
            )
        )
        role_id = (
            await session.execute(select(Role.id).where(Role.key == role_def.key))
        ).scalar_one()
        await session.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
        if role_def.permissions:
            await session.execute(
                insert(RolePermission).from_select(
                    ["role_id", "permission_id"],
                    select(literal(role_id, type_=Role.id.type), Permission.id).where(
                        Permission.key.in_(role_def.permissions)
                    ),
                )
            )


async def list_roles(session: AsyncSession) -> list[Role]:
    return list((await session.execute(select(Role).order_by(Role.key))).scalars().all())


async def get_role(session: AsyncSession, role_id: uuid.UUID) -> Role:
    role = await session.get(Role, role_id)
    if role is None:
        raise NotFoundError("Role not found")
    return role


async def _load_permissions(session: AsyncSession, keys: Iterable[str]) -> list[Permission]:
    wanted = set(keys)
    unknown = wanted - CATALOG_KEYS
    if unknown:
        raise InvalidInputError("Unknown permissions", details={"permissions": sorted(unknown)})
    if not wanted:
        return []
    rows = await session.execute(select(Permission).where(Permission.key.in_(wanted)))
    return sorted(rows.scalars().all(), key=lambda permission: permission.key)


def _ensure_custom(role: Role) -> None:
    if role.is_system:
        raise ForbiddenError("System roles cannot be modified")


async def create_role(session: AsyncSession, data: RoleCreate, context: AuditContext) -> Role:
    if data.key in SYSTEM_ROLE_KEYS:
        raise ConflictError("This key is reserved for a system role")
    permissions = await _load_permissions(session, data.permissions)
    role = Role(key=data.key, name=data.name, description=data.description, is_system=False)
    role.permissions = permissions
    session.add(role)
    try:
        async with session.begin_nested():
            await flush_versioned(session)
    except IntegrityError as exc:
        raise ConflictError("A role with this key already exists") from exc
    audit.record(
        session,
        context,
        action="role.create",
        entity_type="role",
        entity_id=role.id,
        changes={
            "key": {"old": None, "new": role.key},
            "permissions": {"old": [], "new": sorted(data.permissions)},
        },
    )
    return role


async def set_role_permissions(
    session: AsyncSession,
    role_id: uuid.UUID,
    permission_keys: Iterable[str],
    context: AuditContext,
    *,
    expected_version: int,
) -> Role:
    role = await get_role(session, role_id)
    _ensure_custom(role)
    ensure_version(role, expected_version)

    permissions = await _load_permissions(session, permission_keys)
    before = sorted(permission.key for permission in role.permissions)
    after = [permission.key for permission in permissions]
    if before == after:
        return role
    role.permissions = permissions
    role.updated_at = datetime.now(UTC)
    await flush_versioned(session)
    audit.record(
        session,
        context,
        action="role.set_permissions",
        entity_type="role",
        entity_id=role.id,
        changes={"permissions": {"old": before, "new": after}},
    )
    return role


async def delete_role(
    session: AsyncSession, role_id: uuid.UUID, context: AuditContext, *, expected_version: int
) -> None:
    role = await get_role(session, role_id)
    _ensure_custom(role)
    ensure_version(role, expected_version)
    in_use = await session.execute(select(UserRole.user_id).where(UserRole.role_id == role.id))
    if in_use.first() is not None:
        raise ConflictError("The role is assigned to at least one user")
    role_key = role.key
    await session.delete(role)
    await flush_versioned(session)
    audit.record(
        session,
        context,
        action="role.delete",
        entity_type="role",
        entity_id=role_id,
        changes={"key": {"old": role_key, "new": None}},
    )
