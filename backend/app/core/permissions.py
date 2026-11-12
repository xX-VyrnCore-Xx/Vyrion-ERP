"""Permission catalog and built-in roles: the source of truth for RBAC.

A permission key is ``<module>.<resource>:<action>``. Modules add their entries to
``CATALOG``; ``app.services.access.sync_access_catalog`` mirrors it into the database.
"""

import enum
from dataclasses import dataclass


class Action(enum.StrEnum):
    VIEW = "view"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    EXPORT = "export"
    APPROVE = "approve"
    ADMIN = "admin"


@dataclass(frozen=True, slots=True)
class PermissionDef:
    module: str
    resource: str
    action: Action
    description: str

    @property
    def key(self) -> str:
        return f"{self.module}.{self.resource}:{self.action.value}"


def _resource(module: str, resource: str, actions: dict[Action, str]) -> list[PermissionDef]:
    return [PermissionDef(module, resource, action, text) for action, text in actions.items()]


CATALOG: tuple[PermissionDef, ...] = (
    *_resource(
        "core",
        "company",
        {
            Action.VIEW: "View company data",
            Action.UPDATE: "Edit company data and fiscal configuration",
        },
    ),
    *_resource(
        "core",
        "users",
        {
            Action.VIEW: "View users",
            Action.CREATE: "Create users",
            Action.UPDATE: "Edit users",
            Action.DELETE: "Delete users",
            Action.EXPORT: "Export the user list",
            Action.ADMIN: "Assign roles, lock accounts and revoke sessions",
        },
    ),
    *_resource(
        "core",
        "roles",
        {
            Action.VIEW: "View roles and permissions",
            Action.CREATE: "Create custom roles",
            Action.UPDATE: "Edit custom roles",
            Action.DELETE: "Delete custom roles",
        },
    ),
    *_resource(
        "core",
        "audit_log",
        {
            Action.VIEW: "View the audit log",
            Action.EXPORT: "Export the audit log",
        },
    ),
    *_resource(
        "core",
        "backups",
        {
            Action.VIEW: "View the server backup history",
        },
    ),
    *_resource(
        "core",
        "sync",
        {
            Action.VIEW: "Download changes made on other devices",
            Action.UPDATE: "Send this device's changes to the server",
        },
    ),
)

CATALOG_KEYS: frozenset[str] = frozenset(permission.key for permission in CATALOG)


@dataclass(frozen=True, slots=True)
class SystemRoleDef:
    key: str
    name: str
    description: str
    permissions: frozenset[str]


SUPER_ADMIN = "super_admin"

SYSTEM_ROLES: tuple[SystemRoleDef, ...] = (
    SystemRoleDef(
        SUPER_ADMIN,
        "Amministratore principale",
        "Accesso completo, inclusa la gestione degli amministratori.",
        CATALOG_KEYS,
    ),
    SystemRoleDef(
        "admin",
        "Amministratore",
        "Gestione di utenti, ruoli e configurazione aziendale.",
        CATALOG_KEYS,
    ),
    SystemRoleDef(
        "manager",
        "Responsabile",
        "Consultazione di utenti e dati aziendali.",
        frozenset(
            {
                "core.company:view",
                "core.users:view",
                "core.roles:view",
                "core.sync:view",
                "core.sync:update",
            }
        ),
    ),
    SystemRoleDef(
        "employee",
        "Dipendente",
        "Accesso operativo di base.",
        frozenset({"core.company:view", "core.sync:view", "core.sync:update"}),
    ),
    SystemRoleDef(
        "collaborator",
        "Collaboratore",
        "Accesso minimo; i permessi si assegnano tramite ruoli aggiuntivi.",
        frozenset(),
    ),
)

SYSTEM_ROLE_KEYS: frozenset[str] = frozenset(role.key for role in SYSTEM_ROLES)
