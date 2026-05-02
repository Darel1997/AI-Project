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
    # Webhook secret for AI PR Reviewer. If set, incoming webhooks must
    # include a matching X-Hub-Signature-256 HMAC. Leave blank in dev.
    GITHUB_WEBHOOK_SECRET: str = ""

    # ── Slack integration ──
    # Get these from api.slack.com after creating an app for RepoInsight.
    # All optional in dev — feature simply becomes unavailable if unset.
    SLACK_CLIENT_ID: str = ""
    SLACK_CLIENT_SECRET: str = ""
    SLACK_SIGNING_SECRET: str = ""

    # Backend URL is used to construct the OAuth redirect URI for Slack.
    # Default suits local dev; production deploys should override via env.
    BACKEND_URL: str = "http://localhost:8000"

    # ── OpenAI (optional fallback) ────────────────────────
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # ── Anthropic Claude (preferred) ──────────────────────
    ANTHROPIC_API_KEY: str = ""
    # Default model — used for prose-heavy features (docs, onboarding guide).
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"
    # Fast model — used for short structured outputs (audit, security scan,
    # task generation, architecture diagram). Roughly 3-5x faster than Sonnet
    # on the kind of token volumes those features produce.
    ANTHROPIC_HAIKU_MODEL: str = "claude-haiku-4-5-20251001"

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
