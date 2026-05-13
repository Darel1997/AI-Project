"""
RepoInsight AI — FastAPI application entry point.

Registers routers, middleware, and startup/shutdown hooks. The middleware
stack is designed for enterprise deployment:

  • TrustedHost      — refuses requests with spoofed Host headers in prod
  • SecurityHeaders  — sends CSP / X-Frame-Options / HSTS / etc.
  • RequestID        — assigns a UUID to every request and surfaces it in
                       responses + logs so support can trace any incident
  • BodySizeLimit    — refuses payloads larger than 1 MB by default
  • CORS             — locked to the configured FRONTEND_URL, explicit methods
  • Routers          — all of the application's endpoints

In development mode (`APP_ENV != "production"`) the rules relax — `/docs`
is exposed, all hosts are trusted, and the default JWT secret is allowed.
The `_assert_production_safety()` check at startup will refuse to boot a
production deploy if any of those guards are missing.
"""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import JSONResponse, Response
import uuid

from app.core.config import settings
from app.core.database import engine, Base
from app.api.endpoints import (
    auth, repos, chat, ai, analytics, tasks, health, webhooks, organizations,
    billing, blast_radius, onboarding_sim, tribal_knowledge, dependency_radar, time_machine,
    license_scanner, pr_reviewer, compliance, knowledge_graph, slack,
    code_drift, adrs, cross_repo, cost_forecaster, migration,
)

logger = logging.getLogger("repoinsight")

# Whether we're running in production. Drives several security-hardening
# decisions: docs visibility, trusted-host enforcement, default-secret check.
IS_PRODUCTION = settings.APP_ENV.lower() == "production"


def _assert_production_safety() -> None:
    """
    Refuses to start in production if any of the well-known insecure defaults
    are still in place. Better to fail fast on `docker compose up` than to
    serve a forgeable JWT for hours before someone notices.
    """
    if not IS_PRODUCTION:
        return

    problems: list[str] = []

    if settings.JWT_SECRET in ("", "change-me", "your-secret-here", "secret"):
        problems.append(
            "JWT_SECRET is missing or set to a known default. "
            "Generate one with: openssl rand -hex 32"
        )
    if not settings.ANTHROPIC_API_KEY and not settings.OPENAI_API_KEY:
        problems.append("No AI provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).")

    if settings.FRONTEND_URL.startswith("http://") and "localhost" not in settings.FRONTEND_URL:
        problems.append(
            f"FRONTEND_URL={settings.FRONTEND_URL!r} uses plain HTTP. "
            "Use HTTPS in production."
        )
    if settings.DEBUG:
        problems.append("DEBUG=true is unsafe in production. Set DEBUG=false.")
    if not settings.ENCRYPTION_KEY or len(settings.ENCRYPTION_KEY) < 32:
        problems.append(
            "ENCRYPTION_KEY is missing or too short. Sensitive tokens (GitHub OAuth) "
            "would be stored in plaintext. Generate one with: openssl rand -base64 32"
        )
    if (settings.SLACK_CLIENT_ID or settings.SLACK_CLIENT_SECRET) and not settings.SLACK_SIGNING_SECRET:
        problems.append(
            "Slack OAuth is configured but SLACK_SIGNING_SECRET is missing. "
            "Webhook signature verification would be disabled."
        )

    if problems:
        msg = "Refusing to start in production with insecure config:\n  - " + "\n  - ".join(problems)
        logger.critical(msg)
        raise SystemExit(msg)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown hooks."""
    _assert_production_safety()
    logger.info("Starting RepoInsight AI backend (env=%s)...", settings.APP_ENV)

    # Create tables if they don't exist (dev convenience — use Alembic in prod)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Lightweight migrations for columns added after the initial schema.
        from sqlalchemy import text
        for stmt in [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE",
        ]:
            try:
                await conn.execute(text(stmt))
            except Exception as e:
                logger.warning("migration step failed (may already be applied): %s", e)

    logger.info("Database tables verified.")

    # Run startup self-check — surfaces broken imports, missing tables, missing env.
    # Doesn't crash on failure; /health will report what's wrong.
    from app.core.selfcheck import run_selfcheck
    await run_selfcheck(engine)

    yield
    logger.info("Shutting down.")


# ── App initialization ───────────────────────────────────────────
# In production, hide the OpenAPI / Swagger / Redoc surfaces. They leak
# implementation details (route shapes, request models, error formats) that
# are great for attackers and easy enough for our own engineers to access
# locally.
app = FastAPI(
    title="RepoInsight AI",
    description="AI-powered codebase intelligence platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)


# ── Middleware ────────────────────────────────────────────────────
# Order matters in Starlette: middleware ADDED LAST runs FIRST on the
# request side and LAST on the response side. So we add request-id first
# (innermost on requests) and the security headers last (outermost on
# responses, so every response — including errors from earlier middleware
# — gets them).

# 1. Body size limit — refuse oversized payloads BEFORE we parse them.
class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Caps the size of incoming request bodies. Defaults to 1 MB; webhook
    routes that need more (PR diffs can be big) can be exempted by path
    prefix. Without this an attacker could spam the API with multi-GB
    POSTs and exhaust memory before any handler runs.
    """

    def __init__(self, app, max_bytes: int = 1_048_576, exempt_prefixes: tuple[str, ...] = ()):
        super().__init__(app)
        self.max_bytes = max_bytes
        self.exempt_prefixes = exempt_prefixes

    async def dispatch(self, request: Request, call_next):
        if any(request.url.path.startswith(p) for p in self.exempt_prefixes):
            return await call_next(request)

        cl = request.headers.get("content-length")
        if cl is not None:
            try:
                if int(cl) > self.max_bytes:
                    return JSONResponse(
                        {"detail": f"Request body exceeds limit of {self.max_bytes} bytes."},
                        status_code=413,
                    )
            except ValueError:
                # Malformed Content-Length — let the framework reject it later.
                pass
        return await call_next(request)


# 2. Request ID — assigns a UUID to every request and includes it in the
#    response and access logs so an incident report can quote one ID.
class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        # Stash on state so handlers / loggers can pick it up
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response


# 3. Security headers — always-on baseline. CSP is intentionally loose for
#    the API (we don't serve HTML from here, the Next.js frontend does),
#    but everything else is locked down. HSTS only applies to HTTPS responses,
#    so it's safe to set unconditionally.
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        h = response.headers
        # Stop browsers from inferring MIME types — defeats one class of XSS.
        h.setdefault("X-Content-Type-Options", "nosniff")
        # Refuse to be embedded in iframes from elsewhere — clickjacking guard.
        h.setdefault("X-Frame-Options", "DENY")
        # Modern alternative to X-Frame-Options that also covers nested
        # documents and CSS via cross-origin-resource-policy.
        h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        # Clamp Referer so we don't leak full URLs (with query strings) to
        # third parties when the frontend opens external links.
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # Strict CSP for the API surface — JSON only, no scripts.
        h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        # HSTS — tells browsers to use HTTPS for the next year. Only meaningful
        # over HTTPS, but harmless on HTTP responses.
        if IS_PRODUCTION:
            h.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains; preload",
            )
        # Disable browser features the API has no business using.
        h.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        # Stop frames + cross-origin opener leaks.
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        return response


# Add in the order described above. Body size limit FIRST so we add it last.
# GZip the response after all other middleware has had its say. Only
# compresses bodies >= 1 KB — anything smaller costs more CPU to compress
# than it saves in bandwidth. JSON payloads (the bulk of our traffic)
# compress 5-10x so this is a big win on the polled endpoints in particular.
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    BodySizeLimitMiddleware,
    max_bytes=1_048_576,
    # Webhooks may carry larger payloads (full PR diffs).
    exempt_prefixes=("/api/webhooks", "/api/pr-reviewer/webhook"),
)

# 4. CORS — explicit allowlist, explicit methods, explicit headers. The old
#    `allow_methods=["*"]` was a footgun: it accepted any method we add later,
#    even ones we didn't intend to expose to the browser (TRACE, CONNECT, …).
allowed_origins = [settings.FRONTEND_URL]
# Always permit localhost in dev/staging so engineers can run the frontend
# locally against a deployed backend. In production we refuse to add it.
# Only DEVELOPMENT (not staging) should accept localhost origins. Staging
# is an internet-reachable URL and accepting localhost there means a
# malicious local server can read staging session data via CORS.
if settings.APP_ENV.lower() == "development":
    allowed_origins.append("http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization", "Content-Type", "X-Request-ID",
        "X-GitHub-Event", "X-GitHub-Delivery", "X-Hub-Signature-256",
        "X-Slack-Signature", "X-Slack-Request-Timestamp",
    ],
    expose_headers=["X-Request-ID"],
    max_age=3600,
)

# 5. TrustedHost — production only. Refuses requests where Host header doesn't
#    match an expected value. Defense against Host header injection used to
#    poison password-reset emails or cache keys.
if IS_PRODUCTION:
    # Derive trusted hosts from FRONTEND_URL + BACKEND_URL.
    from urllib.parse import urlparse
    trusted = set()
    for url in (settings.FRONTEND_URL, settings.BACKEND_URL):
        host = urlparse(url).hostname
        if host:
            trusted.add(host)
    # Also allow the explicit health-checker hostnames if your LB needs it
    trusted.update({"localhost", "127.0.0.1"})  # for in-pod health checks
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(trusted))


# ── Routers ───────────────────────────────────────────────────────
app.include_router(health.router,     tags=["Health"])
app.include_router(auth.router,       prefix="/api/auth",      tags=["Auth"])
app.include_router(repos.router,      prefix="/api/repos",     tags=["Repos"])
app.include_router(chat.router,       prefix="/api/chat",      tags=["Chat"])
app.include_router(ai.router,         prefix="/api/ai",        tags=["AI"])
app.include_router(analytics.router,  prefix="/api/analytics", tags=["Analytics"])
app.include_router(tasks.router,         prefix="/api/tasks",     tags=["Tasks"])
app.include_router(webhooks.router,      prefix="/api",           tags=["Webhooks"])
app.include_router(organizations.router, prefix="/api/orgs",      tags=["Organizations"])
app.include_router(billing.router,                                tags=["Billing"])
app.include_router(blast_radius.router,                           tags=["Blast Radius"])
app.include_router(onboarding_sim.router,                         tags=["Onboarding Simulator"])
app.include_router(tribal_knowledge.router,                       tags=["Tribal Knowledge"])
app.include_router(dependency_radar.router,                       tags=["Dependency Radar"])
app.include_router(time_machine.router,                           tags=["Time Machine"])
app.include_router(license_scanner.router,                         tags=["License Scanner"])
app.include_router(pr_reviewer.router,                             tags=["PR Reviewer"])
app.include_router(compliance.router,                              tags=["Compliance"])
app.include_router(knowledge_graph.router,                         tags=["Knowledge Graph"])
app.include_router(slack.router,                                   tags=["Slack"])
app.include_router(code_drift.router,                              tags=["Code Drift"])
app.include_router(adrs.router,                                    tags=["ADRs"])
app.include_router(cross_repo.router,                              tags=["Cross-Repo"])
app.include_router(cost_forecaster.router,                         tags=["Cost Forecaster"])
app.include_router(migration.router,                               tags=["Migration"])
