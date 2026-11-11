"""Application settings, loaded exclusively from the environment.

No secret has a default value: the process refuses to start if the database URL, the Redis
URL or the encryption key is missing, so a misconfigured deployment fails loudly.
"""

from functools import lru_cache
from typing import Annotated, Literal

from cryptography.fernet import Fernet
from pydantic import Field, PostgresDsn, RedisDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "test", "production"]

# OWASP minimums for Argon2id; weaker parameters are refused in production.
_ARGON2_MIN_MEMORY_KIB = 19_456
_ARGON2_MIN_TIME_COST = 2


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VYRION_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Environment = "development"
    database_url: PostgresDsn
    redis_url: RedisDsn
    redis_key_prefix: str = Field(default="vyrion", min_length=1, max_length=32)

    # Fernet keys, comma separated. The first encrypts; every key can decrypt, which is what
    # makes rotation possible: prepend the new key, keep the old one until data is re-encrypted.
    encryption_keys: Annotated[list[SecretStr], NoDecode] = Field(min_length=1)

    # Origins of the desktop webview (Tauri) and of the Vite dev server.
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:1420",
        ]
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # Seconds allowed to each dependency probe of the readiness endpoint.
    health_check_timeout: float = Field(default=2.0, gt=0, le=30)

    # --- Sessions -----------------------------------------------------------------
    access_token_ttl_seconds: int = Field(default=15 * 60, ge=60, le=3600)
    refresh_token_ttl_seconds: int = Field(default=14 * 24 * 3600, ge=3600)
    session_absolute_ttl_seconds: int = Field(default=30 * 24 * 3600, ge=3600)
    # A just-rotated refresh token presented again within this window is rejected without
    # revoking the session: it is almost certainly a client retry, not a stolen token.
    refresh_reuse_grace_seconds: int = Field(default=10, ge=0, le=60)

    # --- Brute force protection ---------------------------------------------------
    login_max_failures: int = Field(default=5, ge=1, le=20)
    lockout_seconds: int = Field(default=15 * 60, ge=60)
    login_rate_per_ip: int = Field(default=30, ge=1)  # attempts per minute
    api_rate_per_ip: int = Field(default=600, ge=1)  # requests per minute
    challenge_ttl_seconds: int = Field(default=5 * 60, ge=30, le=900)
    challenge_max_attempts: int = Field(default=5, ge=1, le=10)

    # --- Passwords and second factor ----------------------------------------------
    argon2_time_cost: int = Field(default=3, ge=1)
    argon2_memory_kib: int = Field(default=65_536, ge=8)
    argon2_parallelism: int = Field(default=4, ge=1)
    password_min_length: int = Field(default=12, ge=8, le=64)
    setup_token_ttl_hours: int = Field(default=72, ge=1, le=24 * 14)
    totp_issuer: str = Field(default="Vyrion ERP", min_length=1, max_length=64)

    @field_validator("database_url")
    @classmethod
    def _require_psycopg_driver(cls, value: PostgresDsn) -> PostgresDsn:
        if value.scheme != "postgresql+psycopg":
            raise ValueError("database_url must use the 'postgresql+psycopg://' scheme")
        return value

    @field_validator("encryption_keys", mode="before")
    @classmethod
    def _split_keys(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("encryption_keys")
    @classmethod
    def _keys_must_be_valid_fernet_keys(cls, value: list[SecretStr]) -> list[SecretStr]:
        for key in value:
            try:
                Fernet(key.get_secret_value())
            except (ValueError, TypeError) as exc:
                raise ValueError(
                    "every encryption key must be a Fernet key (32 url-safe base64-encoded "
                    "bytes); generate one with `python -m app.cli generate-key`"
                ) from exc
        return value

    @model_validator(mode="after")
    def _production_hardening(self) -> "Settings":
        if self.is_production and (
            self.argon2_memory_kib < _ARGON2_MIN_MEMORY_KIB
            or self.argon2_time_cost < _ARGON2_MIN_TIME_COST
        ):
            raise ValueError("Argon2id parameters are below the minimum allowed in production")
        if self.session_absolute_ttl_seconds < self.refresh_token_ttl_seconds:
            raise ValueError("session_absolute_ttl_seconds must not be below the refresh ttl")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


class _DatabaseOnlySettings(BaseSettings):
    """Just enough configuration to run migrations: they must not need application secrets."""

    model_config = SettingsConfigDict(
        env_prefix="VYRION_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: PostgresDsn


def get_database_url() -> str:
    return _DatabaseOnlySettings().database_url.unicode_string()


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
