"""ORM models. Importing this package registers every table on ``Base.metadata``."""

from app.models.access import Permission, Role, RolePermission, User, UserPermission, UserRole
from app.models.audit import AuditLog
from app.models.auth import (
    AuthSession,
    LoginChallenge,
    LoginEvent,
    PasswordSetupToken,
    RecoveryCode,
)
from app.models.company import Company, LegalForm, TaxRegime

__all__ = [
    "AuditLog",
    "AuthSession",
    "Company",
    "LegalForm",
    "LoginChallenge",
    "LoginEvent",
    "PasswordSetupToken",
    "Permission",
    "RecoveryCode",
    "Role",
    "RolePermission",
    "TaxRegime",
    "User",
    "UserPermission",
    "UserRole",
]
