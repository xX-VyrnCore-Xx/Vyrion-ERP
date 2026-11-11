"""Housekeeping and first-run setup, usable from the command line without Redis."""

from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import ConflictError, InvalidInputError
from app.core.permissions import SUPER_ADMIN
from app.core.security import PasswordService, password_problems
from app.models.access import Role, User
from app.models.auth import AuthSession, LoginChallenge, PasswordSetupToken
from app.services import audit
from app.services.authz import count_active_super_admins

# Revoked or expired sessions are kept this long so a reused refresh token is still seen.
SESSION_RETENTION = timedelta(days=7)


async def purge_expired(session: AsyncSession) -> dict[str, int]:
    """Delete authentication rows that can no longer be used."""
    now = clock.utcnow()
    cutoff = now - SESSION_RETENTION
    statements = {
        "sessions": delete(AuthSession).where(
            (AuthSession.absolute_expires_at < cutoff)
            | (AuthSession.refresh_expires_at < cutoff)
            | (AuthSession.revoked_at < cutoff)
        ),
        "challenges": delete(LoginChallenge).where(LoginChallenge.expires_at < now),
        "setup_tokens": delete(PasswordSetupToken).where(PasswordSetupToken.expires_at < cutoff),
    }
    counts: dict[str, int] = {}
    for name, statement in statements.items():
        result = await session.execute(statement.execution_options(synchronize_session=False))
        counts[name] = int(result.rowcount)  # type: ignore[attr-defined]
    return counts


async def create_first_admin(
    session: AsyncSession,
    passwords: PasswordService,
    *,
    email: str,
    full_name: str,
    password: str,
    min_password_length: int,
) -> User:
    """Create the main administrator. Refuses when one already exists: further
    administrators are created through the API by someone who holds that role."""
    email = email.strip().lower()
    if await count_active_super_admins(session) > 0:
        raise ConflictError("A main administrator already exists")
    problems = password_problems(
        password, min_length=min_password_length, email=email, full_name=full_name
    )
    if problems:
        raise InvalidInputError("The password is not acceptable", details={"password": problems})
    role = (await session.execute(select(Role).where(Role.key == SUPER_ADMIN))).scalar_one_or_none()
    if role is None:
        raise ConflictError("System roles are missing: run `python -m app.cli bootstrap` first")

    user = User(
        email=email,
        full_name=full_name.strip(),
        password_hash=await passwords.hash_async(password),
        password_changed_at=clock.utcnow(),
        roles=[role],
        direct_permissions=[],
    )
    session.add(user)
    await session.flush()
    audit.record(
        session,
        audit.SYSTEM,
        action="cli.create_first_admin",
        entity_type="user",
        entity_id=user.id,
        changes={"email": email},
    )
    return user
