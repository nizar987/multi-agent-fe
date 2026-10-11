"""
Application settings for core service — loaded from environment variables.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://agentplatform:agentplatform@localhost:5432/agentplatform"

    # gRPC server bind address
    core_host: str = "0.0.0.0"
    core_port: int = 50051

    # Logging
    log_level: str = "INFO"

    # Service version
    version: str = "0.1.0"


settings = Settings()
