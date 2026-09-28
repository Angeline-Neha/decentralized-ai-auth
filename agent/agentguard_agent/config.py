from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    agent_port: int = 8000
    gateway_url: str = "http://127.0.0.1:3001"
    # Hardhat account #1 — default demo agent key
    agent_private_key: str = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78627d"
    grant_id: int = 1
    deployment_path: str = "../contracts/deployments/ganache.json"
    rpc_url: str = "http://127.0.0.1:7545"


def resolve_deployment_path(settings: Settings) -> Path:
    base = Path(__file__).resolve().parent.parent
    return (base / settings.deployment_path).resolve()


settings = Settings()  # type: ignore[call-arg]
