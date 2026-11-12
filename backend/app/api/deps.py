"""Request-scoped dependencies: database session, caller identity, permission checks."""

from collections.abc import AsyncIterator, Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AuthenticationError,
    ForbiddenError,
    SecondFactorRequiredError,
    TooManyRequestsError,
)
from app.core.ratelimit import RateLimiter
from app.services.auth import AuthService
from app.services.authz import AuthContext, ClientInfo

_bearer = HTTPBearer(auto_error=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request. Handlers commit explicitly; anything not committed is rolled
    back when the session closes, so an error never leaves half a change behind."""
    async with request.app.state.session_factory() as session:
        yield session


def get_auth_service(request: Request) -> AuthService:
    service: AuthService = request.app.state.auth
    return service


def get_limiter(request: Request) -> RateLimiter:
    limiter: RateLimiter = request.app.state.limiter
    return limiter


def get_client(request: Request) -> ClientInfo:
    return ClientInfo(
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, "request_id", None),
    )


SessionDep = Annotated[AsyncSession, Depends(get_session)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
ClientDep = Annotated[ClientInfo, Depends(get_client)]


async def rate_limit_ip(request: Request) -> None:
    """Baseline protection for the whole API, per client address."""
    settings = request.app.state.settings
    client = get_client(request)
    hit = await get_limiter(request).hit(f"api-ip:{client.ip or 'unknown'}", window=60)
    if hit.exceeds(settings.api_rate_per_ip):
        raise TooManyRequestsError("Too many requests", retry_after=hit.retry_after)


# Where an administrator without two-factor authentication is still allowed to go: far enough
# to turn it on, change the password, and sign out.
API_PREFIX = "/api/v1"
ENROLMENT_PATHS = frozenset(
    {
        "/auth/me",
        "/auth/logout",
        "/auth/logout-all",
        "/auth/2fa/setup",
        "/auth/2fa/enable",
        "/auth/password/change",
    }
)


async def current_context(
    request: Request,
    session: SessionDep,
    auth: AuthServiceDep,
    client: ClientDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthenticationError()
    context = await auth.authenticate(session, access_token=credentials.credentials, client=client)
    if (
        request.app.state.settings.require_2fa_for_admins
        and context.is_administrator
        and not context.user.totp_enabled
        and request.url.path.removeprefix(API_PREFIX) not in ENROLMENT_PATHS
    ):
        raise SecondFactorRequiredError(
            "Per continuare attiva la verifica in due passaggi del tuo account"
        )
    return context


CurrentContext = Annotated[AuthContext, Depends(current_context)]


def require(*permissions: str) -> Callable[[AuthContext], AuthContext]:
    """Dependency factory: the caller must hold *every* listed permission.

    This is the only place API handlers gain access to protected functions, so a route
    without ``require`` is, by construction, either public or open to any signed-in user.
    """

    def checker(context: CurrentContext) -> AuthContext:
        missing = [key for key in permissions if not context.has(key)]
        if missing:
            raise ForbiddenError("You do not have permission to do this")
        return context

    return checker
