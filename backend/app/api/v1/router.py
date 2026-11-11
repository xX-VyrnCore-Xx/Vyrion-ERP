from fastapi import APIRouter, Depends

from app.api.deps import rate_limit_ip
from app.api.v1 import audit_log, auth, company, health, roles, users

api_router = APIRouter(prefix="/api/v1")

# Health probes stay outside the rate limit: monitoring must always be able to ask.
api_router.include_router(health.router)

_limited = APIRouter(dependencies=[Depends(rate_limit_ip)])
for module in (auth, users, roles, company, audit_log):
    _limited.include_router(module.router)
api_router.include_router(_limited)
