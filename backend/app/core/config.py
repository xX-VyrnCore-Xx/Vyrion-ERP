"""Application settings, loaded exclusively from the environment.

No secret has a default value: the process refuses to start if the database
or Redis URL is missing, so a misconfigured deployment fails loudly.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]


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

    @field_validator("database_url")
    @classmethod
    def _require_psycopg_driver(cls, value: PostgresDsn) -> PostgresDsn:
        if value.scheme != "postgresql+psycopg":
            raise ValueError("database_url must use the 'postgresql+psycopg://' scheme")
        return value

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
