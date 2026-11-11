import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, IPvAnyAddress


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    occurred_at: datetime
    actor_user_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    changes: dict[str, Any]
    ip_address: IPvAnyAddress | None
    user_agent: str | None
    request_id: str | None
