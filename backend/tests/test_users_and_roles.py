import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    ConflictError,
    ForbiddenError,
    InvalidInputError,
    NotFoundError,
    VersionConflictError,
)
from app.core.ids import uuid7
from app.core.permissions import CATALOG_KEYS, SYSTEM_ROLES
from app.models import AuditLog, Permission, Role, RolePermission, User
from app.schemas.access import RoleCreate, RoleRead, UserCreate, UserRead, UserUpdate
from app.services.access import (
    create_role,
    delete_role,
    list_roles,
    set_role_permissions,
    sync_access_catalog,
)
from app.services.audit import SYSTEM, AuditContext, record
from app.services.users import (
    create_user,
    delete_user,
    effective_permissions,
    get_user,
    list_users,
    set_user_roles,
    update_user,
)

pytestmark = pytest.mark.integration


async def _user(session: AsyncSession, email: str = "anna@example.com") -> User:
    return await create_user(session, UserCreate(email=email, full_name="Anna Bianchi"), SYSTEM)


# --- users -----------------------------------------------------------------


async def test_create_normalises_email(db_session: AsyncSession) -> None:
    user = await _user(db_session, "  Anna@Example.COM ")
    assert user.email == "anna@example.com"
    assert user.version == 1
    assert user.is_active
    read = UserRead.model_validate(user)
    assert read.roles == []
    assert read.created_at.tzinfo is not None


def test_invalid_user_input() -> None:
    with pytest.raises(ValidationError):
        UserCreate(email="not-an-email", full_name="X")
    with pytest.raises(ValidationError):
        UserCreate(email="a@example.com", full_name="   ")


async def test_duplicate_email_rejected(db_session: AsyncSession) -> None:
    await _user(db_session)
    with pytest.raises(ConflictError):
        await _user(db_session, "ANNA@example.com")
    # The session is still usable after the conflict.
    assert (await _user(db_session, "other@example.com")).email == "other@example.com"


async def test_database_unique_index_backs_the_check(db_session: AsyncSession) -> None:
    await _user(db_session)
    with pytest.raises(DBAPIError):
        async with db_session.begin_nested():
            await db_session.execute(
                insert(User).values(
                    id=uuid7(),
                    email="anna@example.com",
                    full_name="Clone",
                    is_active=True,
                    version=1,
                )
            )


async def test_partial_update_and_audit(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    actor = AuditContext(actor_user_id=user.id, ip_address="10.8.0.7", request_id="req-1")
    updated = await update_user(
        db_session, user.id, UserUpdate(full_name="Anna B."), actor, expected_version=1
    )
    assert updated.full_name == "Anna B."
    assert updated.email == "anna@example.com"
    assert updated.version == 2
    assert updated.updated_at >= updated.created_at

    await db_session.flush()
    entry = (
        await db_session.execute(select(AuditLog).where(AuditLog.action == "user.update"))
    ).scalar_one()
    assert entry.changes == {"full_name": {"old": "Anna Bianchi", "new": "Anna B."}}
    assert entry.actor_user_id == user.id
    assert str(entry.ip_address) == "10.8.0.7"
    assert entry.request_id == "req-1"


async def test_update_to_taken_email_rejected(db_session: AsyncSession) -> None:
    await _user(db_session)
    other = await _user(db_session, "luca@example.com")
    with pytest.raises(ConflictError):
        await update_user(
            db_session,
            other.id,
            UserUpdate(email="anna@example.com"),
            SYSTEM,
            expected_version=1,
        )


async def test_stale_version_rejected(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    with pytest.raises(VersionConflictError):
        await update_user(
            db_session, user.id, UserUpdate(full_name="X"), SYSTEM, expected_version=99
        )


async def test_concurrent_writer_is_detected(db_session: AsyncSession) -> None:
    """Another writer bumps the row after it was loaded: the flush must not overwrite."""
    user = await _user(db_session)
    await db_session.execute(
        update(User.__table__)  # type: ignore[arg-type]
        .where(User.id == user.id)
        .values(version=User.version + 1, full_name="Changed elsewhere")
    )
    with pytest.raises(VersionConflictError):
        await update_user(
            db_session, user.id, UserUpdate(full_name="Mine"), SYSTEM, expected_version=1
        )


async def test_soft_delete_frees_the_email(db_session: AsyncSession) -> None:
    user = await _user(db_session)
    await delete_user(db_session, user.id, SYSTEM, expected_version=1)
    with pytest.raises(NotFoundError):
        await get_user(db_session, user.id)
    assert (await list_users(db_session)).items == []

    row = (
        await db_session.execute(select(User.deleted_at, User.is_active).where(User.id == user.id))
    ).one()
    assert row.deleted_at is not None
    assert row.is_active is False

    again = await _user(db_session)
    assert again.id != user.id


async def test_unknown_user(db_session: AsyncSession) -> None:
    with pytest.raises(NotFoundError):
        await get_user(db_session, uuid.uuid4())


async def test_keyset_pagination(db_session: AsyncSession) -> None:
    created = [await _user(db_session, f"user{index}@example.com") for index in range(5)]

    seen: list[uuid.UUID] = []
    cursor: str | None = None
    pages = 0
    while True:
        page = await list_users(db_session, limit=2, cursor=cursor)
        seen.extend(user.id for user in page.items)
        pages += 1
        cursor = page.next_cursor
        if cursor is None:
            break
    assert pages == 3
    assert seen == sorted(user.id for user in created)
    assert len(set(seen)) == 5

    with pytest.raises(InvalidInputError):
        await list_users(db_session, cursor="garbage")


# --- roles and permissions -------------------------------------------------


async def test_catalog_sync_is_exact_and_idempotent(db_session: AsyncSession) -> None:
    await sync_access_catalog(db_session)
    # Drift: a permission that no longer exists in code, and a tampered system role.
    stale_id = uuid7()
    await db_session.execute(
        insert(Permission).values(
            id=stale_id, key="old.thing:view", module="old", resource="thing", action="view"
        )
    )
    employee_id = (
        await db_session.execute(select(Role.id).where(Role.key == "employee"))
    ).scalar_one()
    await db_session.execute(
        insert(RolePermission).values(role_id=employee_id, permission_id=stale_id)
    )
    await db_session.execute(delete(RolePermission).where(RolePermission.role_id != employee_id))

    await sync_access_catalog(db_session)
    await sync_access_catalog(db_session)

    keys = set((await db_session.execute(select(Permission.key))).scalars().all())
    assert keys == CATALOG_KEYS
    roles = {role.key: role for role in await list_roles(db_session)}
    for definition in SYSTEM_ROLES:
        role = roles[definition.key]
        assert role.is_system
        assert {permission.key for permission in role.permissions} == definition.permissions
    assert (await db_session.execute(select(func.count()).select_from(Role))).scalar_one() == len(
        SYSTEM_ROLES
    )


async def test_sync_keeps_custom_roles(db_session: AsyncSession) -> None:
    await sync_access_catalog(db_session)
    role = await create_role(
        db_session,
        RoleCreate(key="hr_viewer", name="HR", permissions={"core.users:view"}),
        SYSTEM,
    )
    await sync_access_catalog(db_session)
    refreshed = await db_session.get(Role, role.id, populate_existing=True)
    assert refreshed is not None
    assert [permission.key for permission in refreshed.permissions] == ["core.users:view"]


async def test_custom_role_lifecycle(db_session: AsyncSession) -> None:
    await sync_access_catalog(db_session)
    role = await create_role(
        db_session,
        RoleCreate(key="hr_viewer", name="Risorse umane", permissions={"core.users:view"}),
        SYSTEM,
    )
    assert RoleRead.model_validate(role).permissions[0].key == "core.users:view"

    changed = await set_role_permissions(
        db_session,
        role.id,
        {"core.users:view", "core.users:export"},
        SYSTEM,
        expected_version=role.version,
    )
    assert [permission.key for permission in changed.permissions] == [
        "core.users:export",
        "core.users:view",
    ]
    assert changed.version == 2

    with pytest.raises(VersionConflictError):
        await set_role_permissions(db_session, role.id, set(), SYSTEM, expected_version=1)

    user = await _user(db_session)
    await set_user_roles(db_session, user.id, ["hr_viewer"], SYSTEM, expected_version=1)
    with pytest.raises(ConflictError):
        await delete_role(db_session, role.id, SYSTEM, expected_version=2)

    await set_user_roles(db_session, user.id, [], SYSTEM, expected_version=2)
    await delete_role(db_session, role.id, SYSTEM, expected_version=2)
    assert "hr_viewer" not in {item.key for item in await list_roles(db_session)}


async def test_role_creation_rules(db_session: AsyncSession) -> None:
    await sync_access_catalog(db_session)
    with pytest.raises(ConflictError):
        await create_role(db_session, RoleCreate(key="admin", name="Fake admin"), SYSTEM)
    with pytest.raises(InvalidInputError) as error:
        await create_role(
            db_session,
            RoleCreate(key="bad_role", name="Bad", permissions={"core.users:fly"}),
            SYSTEM,
        )
    assert error.value.details == {"permissions": ["core.users:fly"]}
    await create_role(db_session, RoleCreate(key="twice", name="Once"), SYSTEM)
    with pytest.raises(ConflictError):
        await create_role(db_session, RoleCreate(key="twice", name="Again"), SYSTEM)
    with pytest.raises(ValidationError):
        RoleCreate(key="Not Valid", name="X")


async def test_system_roles_are_immutable(db_session: AsyncSession) -> None:
    await sync_access_catalog(db_session)
    admin = next(role for role in await list_roles(db_session) if role.key == "admin")
    with pytest.raises(ForbiddenError):
        await set_role_permissions(
            db_session, admin.id, set(), SYSTEM, expected_version=admin.version
        )
    with pytest.raises(ForbiddenError):
        await delete_role(db_session, admin.id, SYSTEM, expected_version=admin.version)


async def test_user_roles_and_effective_permissions(db_session: AsyncSession) -> None:
    await sync_access_catalog(db_session)
    user = await _user(db_session)
    assert effective_permissions(user) == frozenset()

    user = await set_user_roles(
        db_session, user.id, ["manager", "employee"], SYSTEM, expected_version=1
    )
    assert [role.key for role in user.roles] == ["employee", "manager"]
    assert user.version == 2
    assert effective_permissions(user) == {
        "core.company:view",
        "core.users:view",
        "core.roles:view",
    }

    with pytest.raises(InvalidInputError) as error:
        await set_user_roles(db_session, user.id, ["manager", "ghost"], SYSTEM, expected_version=2)
    assert error.value.details == {"roles": ["ghost"]}

    user = await update_user(
        db_session, user.id, UserUpdate(is_active=False), SYSTEM, expected_version=2
    )
    assert effective_permissions(user) == frozenset()


# --- audit log -------------------------------------------------------------


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_log SET action = 'tampered'",
        "DELETE FROM audit_log",
        "TRUNCATE audit_log",
    ],
)
async def test_audit_log_is_append_only(db_session: AsyncSession, statement: str) -> None:
    record(db_session, SYSTEM, action="test.event", entity_type="test", entity_id=None)
    await db_session.flush()
    with pytest.raises(DBAPIError, match="append-only"):
        async with db_session.begin_nested():
            await db_session.execute(text(statement))
    remaining = (await db_session.execute(select(AuditLog.action))).scalars().all()
    assert remaining == ["test.event"]
