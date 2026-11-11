import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from app.core.errors import ConflictError, InvalidInputError, NotFoundError, VersionConflictError
from app.core.pagination import Page, clamp_limit, decode_cursor, split_page
from app.models.access import Role, User
from app.schemas.access import UserCreate, UserUpdate
from app.services import audit
from app.services.audit import AuditContext
from app.services.common import ensure_version, flush_versioned

_EMAIL_TAKEN = "A user with this email already exists"


async def get_user(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None or user.is_deleted:
        raise NotFoundError("User not found")
    return user


async def list_users(
    session: AsyncSession, *, limit: int | None = None, cursor: str | None = None
) -> Page[User]:
    size = clamp_limit(limit)
    query = select(User).where(User.deleted_at.is_(None)).order_by(User.id).limit(size + 1)
    if cursor is not None:
        query = query.where(User.id > decode_cursor(cursor))
    rows = (await session.execute(query)).scalars().all()
    items, next_cursor = split_page(rows, size)
    return Page(items=items, next_cursor=next_cursor)


async def _flush_unique_email(session: AsyncSession) -> None:
    # The savepoint keeps the caller's transaction usable if the unique index fires.
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise ConflictError(_EMAIL_TAKEN) from exc
    except StaleDataError as exc:
        raise VersionConflictError("The record was modified by someone else") from exc


async def _ensure_email_free(
    session: AsyncSession, email: str, *, exclude: uuid.UUID | None = None
) -> None:
    query = select(User.id).where(User.email == email, User.deleted_at.is_(None))
    if exclude is not None:
        query = query.where(User.id != exclude)
    if (await session.execute(query)).first() is not None:
        raise ConflictError(_EMAIL_TAKEN)


async def create_user(session: AsyncSession, data: UserCreate, context: AuditContext) -> User:
    await _ensure_email_free(session, data.email)
    # roles=[] marks the collection as loaded: no lazy query on first access.
    user = User(email=data.email, full_name=data.full_name, roles=[])
    session.add(user)
    await _flush_unique_email(session)
    audit.record(
        session,
        context,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        changes=audit.diff({}, {"email": user.email, "full_name": user.full_name}),
    )
    return user


async def update_user(
    session: AsyncSession,
    user_id: uuid.UUID,
    data: UserUpdate,
    context: AuditContext,
    *,
    expected_version: int,
) -> User:
    user = await get_user(session, user_id)
    ensure_version(user, expected_version)

    values = data.model_dump(exclude_unset=True, exclude_none=True)
    changes = audit.diff({key: getattr(user, key) for key in values}, values)
    if not changes:
        return user
    if "email" in changes:
        await _ensure_email_free(session, values["email"], exclude=user.id)
    for key in changes:
        setattr(user, key, values[key])
    await _flush_unique_email(session)
    audit.record(
        session,
        context,
        action="user.update",
        entity_type="user",
        entity_id=user.id,
        changes=changes,
    )
    return user


async def delete_user(
    session: AsyncSession, user_id: uuid.UUID, context: AuditContext, *, expected_version: int
) -> None:
    """Soft delete: the row stays for history, the email becomes available again."""
    user = await get_user(session, user_id)
    ensure_version(user, expected_version)
    user.is_active = False
    user.deleted_at = datetime.now(UTC)
    await flush_versioned(session)
    audit.record(session, context, action="user.delete", entity_type="user", entity_id=user.id)


async def set_user_roles(
    session: AsyncSession,
    user_id: uuid.UUID,
    role_keys: Iterable[str],
    context: AuditContext,
    *,
    expected_version: int,
) -> User:
    """Replace the user's roles with exactly ``role_keys``."""
    user = await get_user(session, user_id)
    ensure_version(user, expected_version)

    wanted = set(role_keys)
    roles = (await session.execute(select(Role).where(Role.key.in_(wanted)))).scalars().all()
    unknown = wanted - {role.key for role in roles}
    if unknown:
        raise InvalidInputError("Unknown roles", details={"roles": sorted(unknown)})

    before = sorted(role.key for role in user.roles)
    after = sorted(wanted)
    if before == after:
        return user
    user.roles = sorted(roles, key=lambda role: role.key)
    # Roles live in a link table: touch the row so its version moves with them.
    user.updated_at = datetime.now(UTC)
    await flush_versioned(session)
    audit.record(
        session,
        context,
        action="user.set_roles",
        entity_type="user",
        entity_id=user.id,
        changes={"roles": {"old": before, "new": after}},
    )
    return user


def effective_permissions(user: User) -> frozenset[str]:
    """Permission keys granted through the user's roles; none if the account is off."""
    if not user.is_active or user.is_deleted:
        return frozenset()
    return frozenset(permission.key for role in user.roles for permission in role.permissions)
