"""Authentication: login, second factor, sessions, refresh tokens, passwords.

Design rules that every function here follows:

* A failed attempt must be *persisted* even though the request ends in an error, so the
  failure paths commit before raising. Success paths leave the commit to the caller.
* Counters that change on every attempt are updated with atomic SQL, never read-modify-write.
* "Unknown account", "wrong password", "disabled account" and "no password yet" are
  indistinguishable from the outside, in content and in cost.
* Tokens are random 256-bit values; only their SHA-256 hashes are stored.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.config import Settings
from app.core.errors import (
    AuthenticationError,
    ConflictError,
    InvalidInputError,
    TooManyRequestsError,
)
from app.core.ratelimit import RateLimiter
from app.core.security import (
    PasswordService,
    SecretBox,
    hash_identifier,
    match_totp_step,
    new_recovery_code,
    new_token,
    new_totp_secret,
    normalise_recovery_code,
    password_problems,
    recovery_code_hash,
    token_hash,
    totp_uri,
)
from app.models.access import User
from app.models.auth import (
    AuthSession,
    LoginChallenge,
    LoginEvent,
    PasswordSetupToken,
    RecoveryCode,
)
from app.services import audit
from app.services.audit import AuditContext
from app.services.authz import AuthContext, ClientInfo, effective_permissions

ACCESS_PREFIX = "vat"
REFRESH_PREFIX = "vrt"
CHALLENGE_PREFIX = "vch"
SETUP_PREFIX = "vst"
RECOVERY_CODE_COUNT = 10
LAST_USED_RESOLUTION = timedelta(seconds=60)

INVALID_CREDENTIALS = "Invalid credentials"


@dataclass(frozen=True, slots=True)
class TokenPair:
    session_id: uuid.UUID
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime


@dataclass(frozen=True, slots=True)
class SecondFactorRequired:
    challenge_token: str
    expires_at: datetime


LoginResult = TokenPair | SecondFactorRequired


@dataclass(frozen=True, slots=True)
class TotpSetup:
    secret: str
    otpauth_uri: str


class AuthService:
    def __init__(
        self,
        settings: Settings,
        passwords: PasswordService,
        box: SecretBox,
        limiter: RateLimiter,
    ) -> None:
        self.settings = settings
        self.passwords = passwords
        self.box = box
        self.limiter = limiter

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _fail_key(email: str) -> str:
        return f"login-fail:{hash_identifier(email)}"

    def _ip_key(self, client: ClientInfo) -> str:
        return f"login-ip:{client.ip or 'unknown'}"

    async def _check_ip_rate(self, client: ClientInfo) -> None:
        hit = await self.limiter.hit(self._ip_key(client), window=60)
        if hit.exceeds(self.settings.login_rate_per_ip):
            raise TooManyRequestsError("Too many attempts", retry_after=hit.retry_after)

    async def _find_user(self, session: AsyncSession, email: str) -> User | None:
        query = select(User).where(User.email == email, User.deleted_at.is_(None))
        return (await session.execute(query)).scalar_one_or_none()

    def _event(
        self,
        session: AsyncSession,
        *,
        email: str,
        user: User | None,
        success: bool,
        reason: str | None,
        client: ClientInfo,
    ) -> None:
        session.add(
            LoginEvent(
                user_id=user.id if user else None,
                email_attempted=email[:320],
                success=success,
                failure_reason=reason,
                ip_address=client.ip,
                user_agent=client.user_agent[:400] if client.user_agent else None,
            )
        )

    async def _register_failure(
        self,
        session: AsyncSession,
        *,
        email: str,
        user: User | None,
        reason: str,
        client: ClientInfo,
        end_sessions_on_lock: bool = False,
    ) -> None:
        """Count a failed attempt in Redis (for every address, existing or not, so that the
        outside view is identical) and in the database (which survives a Redis flush and
        is what an administrator sees). Locks the account at the configured threshold."""
        settings = self.settings
        await self.limiter.hit(self._fail_key(email), window=settings.lockout_seconds)
        if user is not None:
            count = (
                await session.execute(
                    update(User)
                    .where(User.id == user.id)
                    .values(failed_login_count=User.failed_login_count + 1)
                    .returning(User.failed_login_count)
                    .execution_options(synchronize_session=False)
                )
            ).scalar_one()
            if count >= settings.login_max_failures:
                locked_until = clock.utcnow() + timedelta(seconds=settings.lockout_seconds)
                await session.execute(
                    update(User)
                    .where(User.id == user.id)
                    .values(failed_login_count=0, locked_until=locked_until)
                    .execution_options(synchronize_session=False)
                )
                if end_sessions_on_lock:
                    # The guesses came through an authenticated session (a stolen token
                    # probing the password): that session, and every other, must end.
                    await self.revoke_all_sessions(
                        session, user_id=user.id, reason="lockout_during_session"
                    )
        self._event(session, email=email, user=user, success=False, reason=reason, client=client)
        await session.commit()

    async def _clear_failures(self, session: AsyncSession, user: User, email: str) -> None:
        await self.limiter.reset(self._fail_key(email))
        await session.execute(
            update(User)
            .where(User.id == user.id)
            .values(failed_login_count=0, locked_until=None)
            .execution_options(synchronize_session=False)
        )

    async def _open_session(
        self, session: AsyncSession, user: User, client: ClientInfo, *, mfa: bool
    ) -> TokenPair:
        settings = self.settings
        now = clock.utcnow()
        access, refresh = new_token(ACCESS_PREFIX), new_token(REFRESH_PREFIX)
        access_expires = now + timedelta(seconds=settings.access_token_ttl_seconds)
        refresh_expires = now + timedelta(seconds=settings.refresh_token_ttl_seconds)
        row = AuthSession(
            user_id=user.id,
            access_token_hash=token_hash(access),
            access_expires_at=access_expires,
            refresh_token_hash=token_hash(refresh),
            refresh_expires_at=refresh_expires,
            absolute_expires_at=now + timedelta(seconds=settings.session_absolute_ttl_seconds),
            last_used_at=now,
            mfa_verified=mfa,
            ip_address=client.ip,
            user_agent=client.user_agent[:400] if client.user_agent else None,
        )
        session.add(row)
        await session.flush()
        await session.execute(
            update(User)
            .where(User.id == user.id)
            .values(last_login_at=now)
            .execution_options(synchronize_session=False)
        )
        return TokenPair(row.id, access, access_expires, refresh, refresh_expires)

    @staticmethod
    def _locked(user: User, now: datetime) -> bool:
        return user.locked_until is not None and user.locked_until > now

    # -------------------------------------------------------------------- login

    async def login(
        self, session: AsyncSession, *, email: str, password: str, client: ClientInfo
    ) -> LoginResult:
        email = email.strip().lower()
        now = clock.utcnow()
        await self._check_ip_rate(client)

        failures = await self.limiter.peek(self._fail_key(email))
        if failures.count >= self.settings.login_max_failures:
            self._event(
                session, email=email, user=None, success=False, reason="locked", client=client
            )
            await session.commit()
            raise TooManyRequestsError(
                "Too many failed attempts", retry_after=failures.retry_after or 60
            )

        user = await self._find_user(session, email)
        # Always verify, against a decoy when there is nothing to verify against.
        password_ok = await self.passwords.verify_async(
            user.password_hash if user else None, password
        )

        if user is not None and self._locked(user, now):
            self._event(
                session, email=email, user=user, success=False, reason="locked", client=client
            )
            await session.commit()
            raise TooManyRequestsError(
                "Too many failed attempts",
                retry_after=max(int(((user.locked_until or now) - now).total_seconds()), 1),
            )

        if user is None or not user.is_active or not password_ok or user.password_hash is None:
            await self._register_failure(
                session, email=email, user=user, reason="invalid_credentials", client=client
            )
            raise AuthenticationError(INVALID_CREDENTIALS)

        await self._clear_failures(session, user, email)
        if self.passwords.needs_rehash(user.password_hash):
            upgraded = await self.passwords.hash_async(password)
            await session.execute(
                update(User)
                .where(User.id == user.id)
                .values(password_hash=upgraded)
                .execution_options(synchronize_session=False)
            )

        if user.totp_enabled:
            token = new_token(CHALLENGE_PREFIX)
            expires = now + timedelta(seconds=self.settings.challenge_ttl_seconds)
            session.add(
                LoginChallenge(user_id=user.id, token_hash=token_hash(token), expires_at=expires)
            )
            await session.commit()
            return SecondFactorRequired(token, expires)

        pair = await self._open_session(session, user, client, mfa=False)
        self._event(session, email=email, user=user, success=True, reason=None, client=client)
        await session.commit()
        return pair

    async def complete_second_factor(
        self, session: AsyncSession, *, challenge_token: str, code: str, client: ClientInfo
    ) -> TokenPair:
        now = clock.utcnow()
        await self._check_ip_rate(client)
        query = (
            select(LoginChallenge)
            .where(LoginChallenge.token_hash == token_hash(challenge_token))
            .with_for_update()
        )
        challenge = (await session.execute(query)).scalar_one_or_none()
        if challenge is None or challenge.expires_at <= now:
            raise AuthenticationError("Invalid or expired challenge")

        user = await session.get(User, challenge.user_id)
        if (
            user is None
            or user.is_deleted
            or not user.is_active
            or self._locked(user, now)
            or user.totp_secret_encrypted is None
        ):
            raise AuthenticationError("Invalid or expired challenge")

        if challenge.attempts >= self.settings.challenge_max_attempts:
            await session.delete(challenge)
            await session.commit()
            raise AuthenticationError("Invalid or expired challenge")

        accepted, reason = await self._check_second_factor(session, user, code, now)
        if not accepted:
            challenge.attempts += 1
            await self._register_failure(
                session, email=user.email, user=user, reason=reason, client=client
            )
            raise AuthenticationError(INVALID_CREDENTIALS)

        await session.delete(challenge)
        await self._clear_failures(session, user, user.email)
        pair = await self._open_session(session, user, client, mfa=True)
        self._event(session, email=user.email, user=user, success=True, reason=None, client=client)
        await session.commit()
        return pair

    async def _check_second_factor(
        self, session: AsyncSession, user: User, code: str, now: datetime
    ) -> tuple[bool, str]:
        """Accept a TOTP code (once only) or an unused recovery code (once only)."""
        if user.totp_secret_encrypted is None:
            return False, "totp_invalid"
        normalised = normalise_recovery_code(code)
        if len(normalised) == 16:
            used = await session.execute(
                update(RecoveryCode)
                .where(
                    RecoveryCode.user_id == user.id,
                    RecoveryCode.code_hash == recovery_code_hash(code),
                    RecoveryCode.used_at.is_(None),
                )
                .values(used_at=now)
                .execution_options(synchronize_session=False)
            )
            return (used.rowcount == 1, "recovery_invalid")  # type: ignore[attr-defined]

        secret = self.box.decrypt(user.totp_secret_encrypted)
        step = match_totp_step(secret, code.strip(), now=now)
        if step is None:
            return False, "totp_invalid"
        # Atomic anti-replay: only a strictly newer step may win, even under a race.
        advanced = await session.execute(
            update(User)
            .where(
                User.id == user.id, (User.totp_last_step.is_(None)) | (User.totp_last_step < step)
            )
            .values(totp_last_step=step)
            .execution_options(synchronize_session=False)
        )
        return (advanced.rowcount == 1, "totp_replayed")  # type: ignore[attr-defined]

    # ------------------------------------------------------- tokens and sessions

    async def refresh(
        self, session: AsyncSession, *, refresh_token: str, client: ClientInfo
    ) -> TokenPair:
        settings = self.settings
        now = clock.utcnow()
        await self._check_ip_rate(client)
        digest = token_hash(refresh_token)

        row = (
            await session.execute(
                select(AuthSession)
                .where(AuthSession.refresh_token_hash == digest)
                .with_for_update()
            )
        ).scalar_one_or_none()

        if row is None:
            stale = (
                await session.execute(
                    select(AuthSession)
                    .where(AuthSession.previous_refresh_token_hash == digest)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if stale is not None and stale.revoked_at is None:
                grace = timedelta(seconds=settings.refresh_reuse_grace_seconds)
                if stale.rotated_at is None or now - stale.rotated_at > grace:
                    # An already-replaced token is back: assume it was copied. End the session.
                    stale.revoked_at = now
                    stale.revoked_reason = "refresh_reuse"
                    audit.record(
                        session,
                        AuditContext(
                            ip_address=client.ip,
                            user_agent=client.user_agent,
                            request_id=client.request_id,
                        ),
                        action="auth.refresh_reuse_detected",
                        entity_type="session",
                        entity_id=stale.id,
                        changes={"user_id": str(stale.user_id)},
                    )
                    await session.commit()
            raise AuthenticationError()

        user = await session.get(User, row.user_id)
        if (
            row.revoked_at is not None
            or row.refresh_expires_at <= now
            or row.absolute_expires_at <= now
            or user is None
            or user.is_deleted
            or not user.is_active
        ):
            raise AuthenticationError()

        access, refresh = new_token(ACCESS_PREFIX), new_token(REFRESH_PREFIX)
        row.previous_refresh_token_hash = digest
        row.rotated_at = now
        row.refresh_token_hash = token_hash(refresh)
        row.access_token_hash = token_hash(access)
        row.access_expires_at = now + timedelta(seconds=settings.access_token_ttl_seconds)
        row.refresh_expires_at = min(
            now + timedelta(seconds=settings.refresh_token_ttl_seconds), row.absolute_expires_at
        )
        row.last_used_at = now
        row.ip_address = client.ip or row.ip_address
        await session.flush()
        return TokenPair(row.id, access, row.access_expires_at, refresh, row.refresh_expires_at)

    async def authenticate(
        self, session: AsyncSession, *, access_token: str, client: ClientInfo
    ) -> AuthContext:
        """Resolve a bearer token to the acting user. Checked on every request, so a
        revoked session or a disabled account stops working immediately."""
        now = clock.utcnow()
        row = (
            await session.execute(
                select(AuthSession).where(AuthSession.access_token_hash == token_hash(access_token))
            )
        ).scalar_one_or_none()
        if (
            row is None
            or row.revoked_at is not None
            or row.access_expires_at <= now
            or row.absolute_expires_at <= now
        ):
            raise AuthenticationError()
        user = await session.get(User, row.user_id)
        # A brute-force lock stops *new* sign-ins only. Cutting open sessions as well would
        # let anyone who knows an address sign its owner out with five wrong passwords.
        if user is None or user.is_deleted or not user.is_active:
            raise AuthenticationError()

        if now - row.last_used_at > LAST_USED_RESOLUTION:
            await session.execute(
                update(AuthSession)
                .where(AuthSession.id == row.id)
                .values(last_used_at=now)
                .execution_options(synchronize_session=False)
            )
            await session.commit()
        return AuthContext(
            user=user,
            session_id=row.id,
            permissions=effective_permissions(user),
            mfa_verified=row.mfa_verified,
            client=client,
        )

    async def revoke_session(
        self, session: AsyncSession, *, session_id: uuid.UUID, user_id: uuid.UUID, reason: str
    ) -> bool:
        result = await session.execute(
            update(AuthSession)
            .where(
                AuthSession.id == session_id,
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=clock.utcnow(), revoked_reason=reason)
            .execution_options(synchronize_session=False)
        )
        return bool(result.rowcount == 1)  # type: ignore[attr-defined]

    async def revoke_all_sessions(
        self,
        session: AsyncSession,
        *,
        user_id: uuid.UUID,
        reason: str,
        except_session_id: uuid.UUID | None = None,
    ) -> int:
        """Sign the user out of every device (optionally keeping the current one)."""
        query = update(AuthSession).where(
            AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)
        )
        if except_session_id is not None:
            query = query.where(AuthSession.id != except_session_id)
        result = await session.execute(
            query.values(revoked_at=clock.utcnow(), revoked_reason=reason).execution_options(
                synchronize_session=False
            )
        )
        return int(result.rowcount)  # type: ignore[attr-defined]

    async def list_sessions(self, session: AsyncSession, user_id: uuid.UUID) -> list[AuthSession]:
        now = clock.utcnow()
        query = (
            select(AuthSession)
            .where(
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.absolute_expires_at > now,
                AuthSession.refresh_expires_at > now,
            )
            .order_by(AuthSession.last_used_at.desc())
        )
        return list((await session.execute(query)).scalars().all())

    async def list_login_events(
        self, session: AsyncSession, user_id: uuid.UUID, *, limit: int = 50
    ) -> list[LoginEvent]:
        query = (
            select(LoginEvent)
            .where(LoginEvent.user_id == user_id)
            .order_by(LoginEvent.occurred_at.desc(), LoginEvent.id.desc())
            .limit(min(limit, 200))
        )
        return list((await session.execute(query)).scalars().all())

    # ---------------------------------------------------------------- passwords

    def _validate_new_password(self, password: str, user: User) -> None:
        problems = password_problems(
            password,
            min_length=self.settings.password_min_length,
            email=user.email,
            full_name=user.full_name,
        )
        if problems:
            raise InvalidInputError(
                "The password is not acceptable", details={"password": problems}
            )

    async def _set_password(self, session: AsyncSession, user: User, new_password: str) -> None:
        hashed = await self.passwords.hash_async(new_password)
        await session.execute(
            update(User)
            .where(User.id == user.id)
            .values(
                password_hash=hashed,
                password_changed_at=clock.utcnow(),
                failed_login_count=0,
                locked_until=None,
            )
            .execution_options(synchronize_session=False)
        )

    async def change_password(
        self,
        session: AsyncSession,
        *,
        context: AuthContext,
        current_password: str,
        new_password: str,
    ) -> int:
        """Change the caller's password and sign out every *other* device. A wrong current
        password counts like a failed login: a stolen session must not be able to grind
        through guesses here."""
        user, client = context.user, context.client
        await self._check_ip_rate(client)
        if not await self.passwords.verify_async(user.password_hash, current_password):
            await self._register_failure(
                session,
                email=user.email,
                user=user,
                reason="password_change_invalid",
                client=client,
                end_sessions_on_lock=True,
            )
            raise InvalidInputError(
                "The current password is incorrect", details={"field": "current_password"}
            )
        self._validate_new_password(new_password, user)
        await self._set_password(session, user, new_password)
        revoked = await self.revoke_all_sessions(
            session,
            user_id=user.id,
            reason="password_changed",
            except_session_id=context.session_id,
        )
        audit.record(
            session,
            context.audit(),
            action="auth.password_change",
            entity_type="user",
            entity_id=user.id,
            changes={"sessions_revoked": revoked},
        )
        return revoked

    async def create_setup_token(
        self,
        session: AsyncSession,
        *,
        user: User,
        purpose: str,
        created_by: uuid.UUID | None,
    ) -> tuple[str, datetime]:
        """Issue the one-time token a user needs to choose their password. Any earlier
        unused token for the same user is cancelled, so only the latest one works."""
        now = clock.utcnow()
        await session.execute(
            update(PasswordSetupToken)
            .where(PasswordSetupToken.user_id == user.id, PasswordSetupToken.used_at.is_(None))
            .values(used_at=now)
            .execution_options(synchronize_session=False)
        )
        token = new_token(SETUP_PREFIX)
        expires = now + timedelta(hours=self.settings.setup_token_ttl_hours)
        session.add(
            PasswordSetupToken(
                user_id=user.id,
                token_hash=token_hash(token),
                purpose=purpose,
                expires_at=expires,
                created_by=created_by,
            )
        )
        await session.flush()
        return token, expires

    async def set_password_with_token(
        self, session: AsyncSession, *, token: str, new_password: str, client: ClientInfo
    ) -> None:
        now = clock.utcnow()
        await self._check_ip_rate(client)
        row = (
            await session.execute(
                select(PasswordSetupToken)
                .where(PasswordSetupToken.token_hash == token_hash(token))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if row is None or row.used_at is not None or row.expires_at <= now:
            raise AuthenticationError("Invalid or expired token")
        user = await session.get(User, row.user_id)
        if user is None or user.is_deleted or not user.is_active:
            raise AuthenticationError("Invalid or expired token")

        self._validate_new_password(new_password, user)
        await self._set_password(session, user, new_password)
        row.used_at = now
        await self.revoke_all_sessions(session, user_id=user.id, reason="password_reset")
        await self.limiter.reset(self._fail_key(user.email))
        audit.record(
            session,
            AuditContext(
                actor_user_id=user.id,
                ip_address=client.ip,
                user_agent=client.user_agent,
                request_id=client.request_id,
            ),
            action="auth.password_set",
            entity_type="user",
            entity_id=user.id,
            changes={"purpose": row.purpose},
        )

    # ------------------------------------------------------------------- 2FA

    async def begin_totp_setup(self, session: AsyncSession, *, user: User) -> TotpSetup:
        if user.totp_enabled:
            raise ConflictError("Two-factor authentication is already enabled")
        secret = new_totp_secret()
        user.totp_secret_encrypted = self.box.encrypt(secret)
        user.totp_last_step = None
        await session.flush()
        return TotpSetup(
            secret=secret,
            otpauth_uri=totp_uri(secret, account=user.email, issuer=self.settings.totp_issuer),
        )

    async def enable_totp(
        self, session: AsyncSession, *, context: AuthContext, code: str
    ) -> list[str]:
        """Confirm the authenticator app works, switch 2FA on and return the recovery
        codes. They are shown once and stored only as hashes."""
        user = context.user
        if user.totp_enabled:
            raise ConflictError("Two-factor authentication is already enabled")
        if user.totp_secret_encrypted is None:
            raise InvalidInputError("Start the setup first")
        step = match_totp_step(
            self.box.decrypt(user.totp_secret_encrypted), code.strip(), now=clock.utcnow()
        )
        if step is None:
            raise InvalidInputError("The code is not valid", details={"field": "code"})
        user.totp_enabled = True
        user.totp_last_step = step
        codes = await self._replace_recovery_codes(session, user)
        await session.flush()
        audit.record(
            session,
            context.audit(),
            action="auth.2fa_enabled",
            entity_type="user",
            entity_id=user.id,
        )
        return codes

    async def _replace_recovery_codes(self, session: AsyncSession, user: User) -> list[str]:
        await session.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
        codes = [new_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
        session.add_all(
            RecoveryCode(user_id=user.id, code_hash=recovery_code_hash(code)) for code in codes
        )
        return codes

    async def disable_totp(
        self, session: AsyncSession, *, context: AuthContext, password: str, code: str
    ) -> None:
        user, client = context.user, context.client
        await self._check_ip_rate(client)
        if not user.totp_enabled or user.totp_secret_encrypted is None:
            raise ConflictError("Two-factor authentication is not enabled")
        password_ok = await self.passwords.verify_async(user.password_hash, password)
        second_ok, _ = await self._check_second_factor(session, user, code, clock.utcnow())
        if not (password_ok and second_ok):
            await self._register_failure(
                session,
                email=user.email,
                user=user,
                reason="2fa_disable_invalid",
                client=client,
                end_sessions_on_lock=True,
            )
            raise InvalidInputError("Password or code is not correct")
        await self._clear_totp(session, user)
        audit.record(
            session,
            context.audit(),
            action="auth.2fa_disabled",
            entity_type="user",
            entity_id=user.id,
        )

    async def admin_reset_totp(
        self, session: AsyncSession, *, target: User, context: AuthContext
    ) -> None:
        """Lost phone: an administrator switches 2FA off and ends the user's sessions."""
        await self._clear_totp(session, target)
        revoked = await self.revoke_all_sessions(session, user_id=target.id, reason="2fa_reset")
        audit.record(
            session,
            context.audit(),
            action="auth.2fa_reset",
            entity_type="user",
            entity_id=target.id,
            changes={"sessions_revoked": revoked},
        )

    async def _clear_totp(self, session: AsyncSession, user: User) -> None:
        user.totp_enabled = False
        user.totp_secret_encrypted = None
        user.totp_last_step = None
        await session.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
        await session.flush()
