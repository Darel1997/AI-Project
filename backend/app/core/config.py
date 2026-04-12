"""
Centralized configuration via pydantic-settings.

Reads from environment variables / .env file and validates at startup
so we fail fast if a required key is missing.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── App ───────────────────────────────────────────
    APP_ENV: str = "development"
    DEBUG: bool = True

    # ── Database ──────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://repoinsight:repoinsight@db:5432/repoinsight"
    DATABASE_URL_SYNC: str = "postgresql://repoinsight:repoinsight@db:5432/repoinsight"

    # ── Redis ─────────────────────────────────────────
    REDIS_URL: str = "redis://redis:6379/0"

    # ── Auth ──────────────────────────────────────────
    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24 hours

    # ── GitHub ────────────────────────────────────────
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""

    # ── OpenAI ────────────────────────────────────────
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # ── Chroma ────────────────────────────────────────
    CHROMA_HOST: str = "chroma"
    CHROMA_PORT: int = 8000

    # ── URLs ──────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"

    # ── Rate Limiting ─────────────────────────────────
    RATE_LIMIT_PER_MINUTE: int = 60

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
