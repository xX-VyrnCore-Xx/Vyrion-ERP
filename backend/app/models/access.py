"""Users, roles and permissions (the data model behind RBAC).

Credentials, sessions and enforcement arrive with milestone 4; until then no endpoint
exposes these tables.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionedMixin


class User(UUIDPrimaryKeyMixin, TimestampMixin, VersionedMixin, SoftDeleteMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        # An address is unique among active users; a deleted user frees it.
        Index(
            "uq_users_email_active",
            "email",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)  # stored lowercase
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    roles: Mapped[list["Role"]] = relationship(
        secondary="user_roles", lazy="selectin", order_by="Role.key"
    )


class Role(UUIDPrimaryKeyMixin, TimestampMixin, VersionedMixin, Base):
    __tablename__ = "roles"

    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # System roles are defined in code and cannot be edited or deleted.
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    permissions: Mapped[list["Permission"]] = relationship(
        secondary="role_permissions", lazy="selectin", order_by="Permission.key"
    )


class Permission(UUIDPrimaryKeyMixin, Base):
    """One grantable action on one resource, e.g. ``core.users:create``.

    The catalog lives in ``app.core.permissions``; this table mirrors it so that
    grants can reference it with foreign keys.
    """

    __tablename__ = "permissions"

    key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    module: Mapped[str] = mapped_column(String(32), nullable=False)
    resource: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True, index=True
    )
