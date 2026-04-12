"""
RepoInsight AI — FastAPI application entry point.

Registers routers, middleware, and startup/shutdown hooks.
"""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base
from app.api.endpoints import auth, repos, chat, ai, analytics, tasks, health

logger = logging.getLogger("repoinsight")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown hooks."""
    logger.info("Starting RepoInsight AI backend...")
    # Create tables if they don't exist (dev convenience — use Alembic in prod)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables verified.")
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="RepoInsight AI",
    description="AI-powered codebase intelligence platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────
app.include_router(health.router,     tags=["Health"])
app.include_router(auth.router,       prefix="/api/auth",      tags=["Auth"])
app.include_router(repos.router,      prefix="/api/repos",     tags=["Repos"])
app.include_router(chat.router,       prefix="/api/chat",      tags=["Chat"])
app.include_router(ai.router,         prefix="/api/ai",        tags=["AI"])
app.include_router(analytics.router,  prefix="/api/analytics", tags=["Analytics"])
app.include_router(tasks.router,      prefix="/api/tasks",     tags=["Tasks"])
