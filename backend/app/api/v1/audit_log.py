import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import SessionDep, require
from app.schemas.audit import AuditLogRead
from app.schemas.common import PageResponse
from app.services import audit
from app.services.authz import AuthContext

router = APIRouter(prefix="/audit-log", tags=["audit"])

ViewAudit = Annotated[AuthContext, Depends(require("core.audit_log:view"))]


@router.get("", response_model=PageResponse[AuditLogRead])
async def list_audit_log(
    _: ViewAudit,
    session: SessionDep,
    entity_type: Annotated[str | None, Query(max_length=64)] = None,
    entity_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    action: Annotated[str | None, Query(max_length=64)] = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    cursor: str | None = None,
) -> PageResponse[AuditLogRead]:
    page = await audit.list_entries(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_user_id=actor_user_id,
        action=action,
        since=since,
        until=until,
        limit=limit,
        cursor=cursor,
    )
    return PageResponse(
        items=[AuditLogRead.model_validate(entry) for entry in page.items],
        next_cursor=page.next_cursor,
    )
