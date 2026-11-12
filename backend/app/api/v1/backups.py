from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import require
from app.schemas.backups import BackupOverview
from app.services import backups as backups_service
from app.services.authz import AuthContext

router = APIRouter(prefix="/backups", tags=["backups"])

ViewBackups = Annotated[AuthContext, Depends(require("core.backups:view"))]


@router.get("", response_model=BackupOverview)
async def get_backups(_: ViewBackups, request: Request) -> BackupOverview:
    """Latest runs, integrity checks, restore tests and the files kept, from the real log."""
    return await backups_service.overview(request.app.state.settings.backup_dir)
