"""
Gateway application settings — loaded from environment variables.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Core gRPC service address
    core_host: str = "localhost"
    core_port: int = 50051

    # Bearer token for frontend → gateway auth
    gateway_secret: str = "changeme-dev-secret"

    # Server bind
    host: str = "0.0.0.0"
    port: int = 8000

    # Logging
    log_level: str = "INFO"

    # Version
    version: str = "0.1.0"

    @property
    def core_address(self) -> str:
        return f"{self.core_host}:{self.core_port}"


settings = Settings()
