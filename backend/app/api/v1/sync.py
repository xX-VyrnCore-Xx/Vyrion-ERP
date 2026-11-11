import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import SessionDep, require
from app.schemas.sync import PullResponse, PushRequest, PushResponse
from app.services import sync as sync_service
from app.services.authz import AuthContext

router = APIRouter(prefix="/sync", tags=["sync"])

PushAllowed = Annotated[AuthContext, Depends(require("core.sync:update"))]
PullAllowed = Annotated[AuthContext, Depends(require("core.sync:view"))]


@router.post("/push", response_model=PushResponse)
async def push(body: PushRequest, actor: PushAllowed, session: SessionDep) -> PushResponse:
    """Send operations; every one gets its own result."""
    result = await sync_service.push(
        session, user_id=actor.user.id, device_id=body.device_id, operations=body.operations
    )
    await session.commit()
    return result


@router.get("/pull", response_model=PullResponse)
async def pull(
    _: PullAllowed,
    session: SessionDep,
    device_id: uuid.UUID,
    after: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> PullResponse:
    """Records changed by other devices since the cursor ``after``."""
    return await sync_service.pull(session, device_id=device_id, after=after, limit=limit)
