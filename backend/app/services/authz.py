"""Who is acting and what they may do: the authorization context and the guard rules.

Permissions are always evaluated here, on the server. Whatever the desktop client hides
or shows is a convenience only.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ForbiddenError
from app.core.permissions import SUPER_ADMIN
from app.models.access import Role, User, UserRole
from app.services.audit import AuditContext

# Managing users that hold these roles, or handing the roles out, is reserved to the
# main administrator. Otherwise an "admin" could promote themselves to the top.
PROTECTED_ROLE_KEYS = frozenset({"super_admin", "admin"})


@dataclass(frozen=True, slots=True)
class ClientInfo:
    ip: str | None = None
    user_agent: str | None = None
    request_id: str | None = None


@dataclass(frozen=True, slots=True)
class AuthContext:
    user: User
    session_id: uuid.UUID
    permissions: frozenset[str]
    mfa_verified: bool
    client: ClientInfo

    @property
    def role_keys(self) -> frozenset[str]:
        return frozenset(role.key for role in self.user.roles)

    @property
    def is_super_admin(self) -> bool:
        return SUPER_ADMIN in self.role_keys

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def audit(self) -> AuditContext:
        return AuditContext(
            actor_user_id=self.user.id,
            ip_address=self.client.ip,
            user_agent=self.client.user_agent,
            request_id=self.client.request_id,
        )


def effective_permissions(user: User) -> frozenset[str]:
    """Permission keys granted through roles plus those granted to the user directly.

    A deactivated or deleted account has none, whatever it was granted.
    """
    if not user.is_active or user.is_deleted:
        return frozenset()
    granted = {permission.key for role in user.roles for permission in role.permissions}
    granted.update(permission.key for permission in user.direct_permissions)
    return frozenset(granted)


def ensure_can_manage(actor: AuthContext, target: User) -> None:
    """Refuse to act on a protected account unless the actor is the main administrator."""
    if actor.is_super_admin:
        return
    if any(role.key in PROTECTED_ROLE_KEYS for role in target.roles):
        raise ForbiddenError("Only the main administrator can manage administrator accounts")


def ensure_can_grant(
    actor: AuthContext, *, role_keys: Iterable[str] = (), permission_keys: Iterable[str] = ()
) -> None:
    """Nobody can hand out more than they hold.

    Handing out a protected role needs the main administrator; every permission granted,
    directly or through a role, must be one the actor already has.
    """
    if actor.is_super_admin:
        return
    protected = set(role_keys) & PROTECTED_ROLE_KEYS
    if protected:
        raise ForbiddenError(
            "Only the main administrator can assign administrator roles",
            details={"roles": sorted(protected)},
        )
    missing = set(permission_keys) - actor.permissions
    if missing:
        raise ForbiddenError(
            "You cannot grant permissions you do not hold",
            details={"permissions": sorted(missing)},
        )


async def count_active_super_admins(session: AsyncSession) -> int:
    query = (
        select(func.count(func.distinct(User.id)))
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.key == SUPER_ADMIN, User.is_active.is_(True), User.deleted_at.is_(None))
    )
    return int((await session.execute(query)).scalar_one())


async def ensure_not_last_super_admin(session: AsyncSession, target: User) -> None:
    """The company must always keep at least one active main administrator."""
    holds_role = any(role.key == SUPER_ADMIN for role in target.roles)
    if holds_role and target.is_active and await count_active_super_admins(session) <= 1:
        raise ForbiddenError("This is the last active main administrator")
