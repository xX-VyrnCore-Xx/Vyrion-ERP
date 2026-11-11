"""User administration as performed by a signed-in administrator.

Each function enforces the guard rules on top of the plain data operations in
``app.services.users``: nobody can hand out more than they hold, administrator accounts
are managed only by the main administrator, nobody edits their own privileges, and the
last main administrator can never be removed or demoted.
"""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ForbiddenError, InvalidInputError
from app.core.permissions import CATALOG_KEYS, SUPER_ADMIN
from app.models.access import Permission, Role, User
from app.schemas.access import UserCreate, UserUpdate
from app.services import audit, users
from app.services.auth import AuthService
from app.services.authz import (
    AuthContext,
    ensure_can_grant,
    ensure_can_manage,
    ensure_not_last_super_admin,
)
from app.services.common import ensure_version, flush_versioned


def _not_self(actor: AuthContext, user_id: uuid.UUID, what: str) -> None:
    if actor.user.id == user_id:
        raise ForbiddenError(f"You cannot {what} your own account")


async def invite_user(
    session: AsyncSession, auth: AuthService, actor: AuthContext, data: UserCreate
) -> tuple[User, str, datetime]:
    """Create an account without a password and return the one-time setup token."""
    user = await users.create_user(session, data, actor.audit())
    token, expires = await auth.create_setup_token(
        session, user=user, purpose="invite", created_by=actor.user.id
    )
    return user, token, expires


async def update_user(
    session: AsyncSession,
    auth: AuthService,
    actor: AuthContext,
    user_id: uuid.UUID,
    data: UserUpdate,
    *,
    expected_version: int,
) -> User:
    target = await users.get_user(session, user_id)
    ensure_can_manage(actor, target)
    if data.is_active is not None and data.is_active != target.is_active:
        _not_self(actor, user_id, "deactivate")
        if not actor.has("core.users:admin"):
            raise ForbiddenError("Activating or deactivating accounts needs the admin permission")
        if not data.is_active:
            await ensure_not_last_super_admin(session, target)
    updated = await users.update_user(
        session, user_id, data, actor.audit(), expected_version=expected_version
    )
    if not updated.is_active:
        await auth.revoke_all_sessions(session, user_id=user_id, reason="account_disabled")
    return updated


async def delete_user(
    session: AsyncSession,
    auth: AuthService,
    actor: AuthContext,
    user_id: uuid.UUID,
    *,
    expected_version: int,
) -> None:
    _not_self(actor, user_id, "delete")
    target = await users.get_user(session, user_id)
    ensure_can_manage(actor, target)
    await ensure_not_last_super_admin(session, target)
    await users.delete_user(session, user_id, actor.audit(), expected_version=expected_version)
    await auth.revoke_all_sessions(session, user_id=user_id, reason="account_deleted")


async def _roles_by_key(session: AsyncSession, keys: Iterable[str]) -> list[Role]:
    wanted = set(keys)
    rows = (await session.execute(select(Role).where(Role.key.in_(wanted)))).scalars().all()
    unknown = wanted - {role.key for role in rows}
    if unknown:
        raise InvalidInputError("Unknown roles", details={"roles": sorted(unknown)})
    return list(rows)


async def assign_roles(
    session: AsyncSession,
    auth: AuthService,
    actor: AuthContext,
    user_id: uuid.UUID,
    role_keys: Iterable[str],
    *,
    expected_version: int,
) -> User:
    wanted = set(role_keys)
    _not_self(actor, user_id, "change the roles of")
    target = await users.get_user(session, user_id)
    ensure_can_manage(actor, target)

    roles = await _roles_by_key(session, wanted)
    current = {role.key for role in target.roles}
    granted_permissions = {
        permission.key
        for role in roles
        if role.key in wanted - current
        for permission in role.permissions
    }
    ensure_can_grant(actor, role_keys=wanted - current, permission_keys=granted_permissions)
    if SUPER_ADMIN in current and SUPER_ADMIN not in wanted:
        await ensure_not_last_super_admin(session, target)

    updated = await users.set_user_roles(
        session, user_id, wanted, actor.audit(), expected_version=expected_version
    )
    # Permissions changed: the next request recomputes them, but cutting sessions short
    # when privileges are *removed* is the safer behaviour.
    if current - wanted:
        await auth.revoke_all_sessions(session, user_id=user_id, reason="roles_reduced")
    return updated


async def assign_permissions(
    session: AsyncSession,
    actor: AuthContext,
    user_id: uuid.UUID,
    permission_keys: Iterable[str],
    *,
    expected_version: int,
) -> User:
    """Replace the permissions granted to a user directly (on top of their roles)."""
    wanted = set(permission_keys)
    unknown = wanted - CATALOG_KEYS
    if unknown:
        raise InvalidInputError("Unknown permissions", details={"permissions": sorted(unknown)})
    _not_self(actor, user_id, "change the permissions of")
    target = await users.get_user(session, user_id)
    ensure_can_manage(actor, target)
    ensure_version(target, expected_version)

    before = sorted(permission.key for permission in target.direct_permissions)
    ensure_can_grant(actor, permission_keys=wanted - set(before))
    after = sorted(wanted)
    if before == after:
        return target

    rows = (
        (await session.execute(select(Permission).where(Permission.key.in_(wanted))))
        .scalars()
        .all()
        if wanted
        else []
    )
    target.direct_permissions = sorted(rows, key=lambda permission: permission.key)
    target.updated_at = datetime.now(UTC)
    await flush_versioned(session)
    audit.record(
        session,
        actor.audit(),
        action="user.set_permissions",
        entity_type="user",
        entity_id=target.id,
        changes={"permissions": {"old": before, "new": after}},
    )
    return target


async def revoke_user_sessions(
    session: AsyncSession, auth: AuthService, actor: AuthContext, user_id: uuid.UUID
) -> int:
    """Disconnect a user from every device."""
    target = await users.get_user(session, user_id)
    ensure_can_manage(actor, target)
    revoked = await auth.revoke_all_sessions(session, user_id=user_id, reason="admin_revoked")
    audit.record(
        session,
        actor.audit(),
        action="user.revoke_sessions",
        entity_type="user",
        entity_id=user_id,
        changes={"sessions_revoked": revoked},
    )
    return revoked


async def issue_password_reset(
    session: AsyncSession, auth: AuthService, actor: AuthContext, user_id: uuid.UUID
) -> tuple[str, datetime]:
    target = await users.get_user(session, user_id)
    ensure_can_manage(actor, target)
    if not target.is_active:
        raise ConflictError("The account is disabled")
    token, expires = await auth.create_setup_token(
        session, user=target, purpose="reset", created_by=actor.user.id
    )
    audit.record(
        session,
        actor.audit(),
        action="user.password_reset_issued",
        entity_type="user",
        entity_id=user_id,
    )
    return token, expires


async def reset_two_factor(
    session: AsyncSession,
    auth: AuthService,
    actor: AuthContext,
    user_id: uuid.UUID,
) -> None:
    target = await users.get_user(session, user_id)
    ensure_can_manage(actor, target)
    await auth.admin_reset_totp(session, target=target, context=actor)
