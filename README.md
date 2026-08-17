<div align="center">

<img src="assets/repoinsight-logo.svg" alt="RepoInsight AI" width="128" height="128">

# RepoInsight AI

**Codebase intelligence for engineering teams.**
Index any GitHub repository, then chat with it, document it, audit it, and ship faster — all from one workspace.

[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-7c6bff?style=flat-square)](LICENSE)
[![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com)
[![Built with Claude](https://img.shields.io/badge/AI-Anthropic_Claude-d97757?style=flat-square)](https://anthropic.com)

[Documentation](docs/) · [Changelog](https://darel-rodriguez.com/repoinsight/changelog) · [Report a vulnerability](#responsible-disclosure)

</div>

---

## Contents

1. [What RepoInsight does](#what-repoinsight-does)
2. [How it works](#how-it-works)
3. [Quick start](#quick-start)
4. [Configuration](#configuration)
5. [Local development](#local-development)
6. [Tech stack](#tech-stack)
7. [Project layout](#project-layout)
8. [Deployment](#deployment)
9. [Responsible disclosure](#responsible-disclosure)
10. [License](#license)

---

## What RepoInsight does

RepoInsight ingests a Git repository, chunks every source file, embeds those chunks into a vector store, and then layers a suite of AI products on top. Every answer it produces is grounded in your actual source — every claim cites the file and line range it came from.

### Core

| Capability | What you get |
| --- | --- |
| **Chat with your code** | Ask plain-English questions; get answers with clickable citations to specific files and line ranges. |
| **Auto documentation** | Module-level docs, architecture overviews, and onboarding guides regenerated on demand. |
| **Security scanner** | CWE-classified findings (hardcoded secrets, SQLi, XSS, auth flaws) with concrete remediation steps. |
| **Code quality audits** | Code smells, complexity hotspots, and missing-test reports — each finding ships with a suggested fix. |
| **Architecture maps** | Auto-drawn Mermaid diagrams of services, modules, and the dependencies between them. |
| **Task generation** | Jira-style tickets with priority, difficulty, and the exact files a developer should touch. |
| **Auto re-index on push** | GitHub webhooks (HMAC-verified via `X-Hub-Signature-256`) keep every artifact fresh. |
| **Team workspaces** | Shared orgs, role-based access, and plan-gated features. |

### Analysis lab

Beyond the core set, the API exposes a second tier of analyses. Each has its own
endpoint under `backend/app/api/endpoints/`:

| Capability | Endpoint |
| --- | --- |
| **AI pull-request reviewer** | `pr_reviewer.py` |
| **Blast-radius analysis** — what breaks if you change this file | `blast_radius.py` |
| **Code drift** — where the code and its docs have diverged | `code_drift.py` |
| **Knowledge graph** — entities and relationships across the repo | `knowledge_graph.py` |
| **Cross-repo search** — query several indexed repos at once | `cross_repo.py` |
| **Dependency radar** and **license scanner** | `dependency_radar.py`, `license_scanner.py` |
| **ADR extraction** — architectural decisions recovered from history | `adrs.py` |
| **Time machine** — how a module evolved over time | `time_machine.py` |
| **Tribal knowledge** — the undocumented context held by past authors | `tribal_knowledge.py` |
| **Onboarding simulator**, **migration planner**, **cost forecaster** | `onboarding_sim.py`, `migration.py`, `cost_forecaster.py` |
| **Compliance reporting** | `compliance.py` |
| **Slack integration** | `slack.py` |

> **No fabricated metrics.** Every claim in this README is something the code
> actually does. Where a feature depends on configuration you haven't set, the
> app says so at runtime rather than failing silently.

---

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend                          │
│      Dashboard · Chat · Repo detail · Analytics · Settings        │
└──────────────────────────┬────────────────────────────────────────┘
                           │ REST + JWT
┌──────────────────────────▼────────────────────────────────────────┐
│                          FastAPI Backend                           │
│      Auth · Repos · AI services · Webhooks · Billing · Orgs       │
├────────────┬────────────┬────────────┬────────────────────────────┤
│ PostgreSQL │  ChromaDB  │   Redis    │  Celery workers           │
│ (metadata) │ (vectors)  │ (queue)    │  (indexing, AI jobs)      │
└────────────┴────────────┴────────────┴────────────────────────────┘
                           │
                ┌──────────▼──────────┐
                │   GitHub REST API   │  (read-only repo access)
                │   Anthropic Claude  │  (zero-retention inference)
                └─────────────────────┘
```

### Indexing pipeline

1. **Fetch.** Tarball download via the GitHub API. Binaries, lockfiles, and files larger than 2 MB are filtered before download to save bandwidth.
2. **Chunk.** Tree-sitter where available; falls back to a sliding character window with overlap.
3. **Embed.** Local `sentence-transformers` running `all-MiniLM-L6-v2` — no embedding API costs, no third-party data egress, no key required.
4. **Persist.** Vectors land in ChromaDB; metadata in Postgres; both are written in batches to keep transactions short.
5. **Notify.** Progress is streamed back to the dashboard so you watch the index build live.

### Inference pipeline

For every user question, RepoInsight retrieves the top-k most relevant chunks, sends only those chunks to the model (never the whole repo), and renders the response with inline citations back to the file and line range.

Two Claude models are used, selected per feature in `app/core/config.py`:

| Setting | Default | Used for |
| --- | --- | --- |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Prose-heavy work — docs, onboarding guides, chat. |
| `ANTHROPIC_HAIKU_MODEL` | `claude-haiku-4-5-20251001` | Short structured output — audits, security scans, task generation, diagrams. |

---

## Quick start

The fastest path is `docker compose up`. It boots the frontend, API, workers, Postgres, Redis, and ChromaDB in roughly five minutes on a modern laptop.

### Prerequisites

| Tool | Why | Install |
| --- | --- | --- |
| Docker Desktop | Runs every service in a container | https://www.docker.com/products/docker-desktop |
| Anthropic API key | Powers all AI features | https://console.anthropic.com/settings/keys |
| GitHub OAuth app *(optional)* | Sign-in with GitHub + private repo access | https://github.com/settings/developers |

> If you skip the GitHub OAuth app you can still register with email/password and analyze any **public** repository.

### Install

```bash
git clone https://github.com/Darel1997/RepoInsight.git
cd RepoInsight

cp .env.example .env       # then edit .env and add your API key
docker compose up --build  # build and start every service
```

Compose starts the services in dependency order and waits for Postgres, Redis,
and ChromaDB to report healthy before the API boots, and for the API to report
healthy before the frontend does. The first build takes a few minutes; after
that, `docker compose up` is quick.

When it finishes:

- **App** — http://localhost:3000
- **API docs (OpenAPI)** — http://localhost:8000/docs
- **Health check** — http://localhost:8000/health/detail

The database schema is created automatically at API startup, so there is no
separate migration step for a fresh install.

### Troubleshooting

> **"Cannot reach the API server at http://localhost:8000"**
>
> The frontend is up but the backend isn't responding. Usually one of these:
>
> 1. **The API is still starting.** First-time builds take 30–60 seconds for the
>    Python image to install dependencies and initialize the schema. Compose waits
>    for the API to report healthy before starting the frontend, so a fresh
>    `docker compose up` shouldn't show this — but a partial
>    `docker compose restart frontend` can.
> 2. **The API crashed.** Run `docker compose ps` — the `api` service should say
>    `healthy`. If it says `unhealthy` or is missing, run
>    `docker compose logs api --tail 50` and look for the error.
> 3. **No AI provider configured.** The API starts and serves `/health`, but every
>    AI request fails. Visit `/health/detail` to confirm which keys it can see.
> 4. **Port 8000 is taken.** Another process is bound to it. Stop that process, or
>    change the API's host port in `docker-compose.yml`.
>
> The frontend shows a banner on the auth and dashboard pages when the backend is
> unreachable, with a Retry button — you don't need to reload once the API recovers.

---

## Configuration

Every environment variable lives in `.env.example` with comments. The ones that matter:

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ✅ * | Powers chat, audits, security scanning, and every AI artifact. |
| `JWT_SECRET` | ✅ | Signs auth tokens. Use a 32-byte random string. |
| `DATABASE_URL` / `DATABASE_URL_SYNC` | ✅ | Async and sync Postgres connection strings. The defaults work inside Docker. |
| `REDIS_URL` | ✅ | Used by Celery and the rate limiter. The default works inside Docker. |
| `ENCRYPTION_KEY` | ✅ in production | Encrypts stored OAuth tokens at rest. Generate with `openssl rand -base64 32`. The startup check refuses to boot without it when `APP_ENV=production`. |
| `ENCRYPTION_KEY_ROTATION` | Optional | Comma-separated older keys, accepted for decryption only, so you can rotate without invalidating existing tokens. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional | GitHub OAuth app credentials. Required for private repos. |
| `GITHUB_WEBHOOK_SECRET` | Optional | Enables HMAC verification on incoming webhooks. Leave blank in dev. |
| `OPENAI_API_KEY` | Optional | Fallback AI provider — see the note below. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` | Optional | Slack app credentials. The Slack feature is simply unavailable if unset. |
| `RATE_LIMIT_PER_MINUTE` | Optional | Defaults to 60. |
| `TRUSTED_PROXIES` | Optional | Comma-separated IPs/CIDRs allowed to set `X-Forwarded-For`. Empty (the default) trusts none — correct for local dev. |
| `NEXT_PUBLIC_API_URL` | Optional | Defaults to `http://localhost:8000`. |

\* **At least one** of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` must be set. The
startup check in `app/main.py` reports a problem if neither is present.

> **On AI providers.** Claude is the default and the recommended path — the
> prompts and model routing are tuned for it. OpenAI is supported as a fallback:
> `app/services/ai_service.py` selects it when `OPENAI_API_KEY` is set to a real
> value, and `OPENAI_MODEL` defaults to `gpt-4o`. Embeddings never touch either
> provider; they run locally through `sentence-transformers`, so
> `OPENAI_EMBEDDING_MODEL` is vestigial and setting it changes nothing.

### Billing (optional)

The billing endpoints read Stripe credentials directly from the environment
(`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, and the
per-plan `STRIPE_PRICE_*` variables). These are **not** in `.env.example`. If
`STRIPE_SECRET_KEY` is unset, the endpoints fall back to stub behaviour so the
rest of the app runs normally — you only need them if you're turning on paid plans.

---

## Local development

If you'd rather skip Docker and run the services on your host:

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Tables are created on startup from the SQLAlchemy models. `backend/schema.sql`
is the reference schema if you'd rather provision the database yourself. Note
that Postgres, Redis, and ChromaDB still need to be reachable — the defaults in
`config.py` point at Docker hostnames (`db`, `redis`, `chroma`), so override
`DATABASE_URL`, `REDIS_URL`, and `CHROMA_HOST` when running on the host.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Background workers

```bash
cd backend
celery -A app.workers.celery_app worker --loglevel=info
```

### Test suites

```bash
# Backend (pytest)
cd backend && pytest

# Frontend unit tests (Vitest)
cd frontend && npm test

# Frontend end-to-end (Playwright)
cd frontend && npx playwright test
```

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 14 (App Router), React, Tailwind CSS, Recharts, Mermaid | First-class SSR, file-based routing, mature ecosystem. |
| Backend | Python 3.11, FastAPI, SQLAlchemy 2 | Async-first, type-safe, automatic OpenAPI. |
| AI / RAG | Anthropic Claude (OpenAI optional), sentence-transformers, ChromaDB | Zero-retention inference, local embeddings, no data egress for indexing. |
| Queue | Celery + Redis | Battle-tested for long-running indexing jobs. |
| Database | PostgreSQL | Relational metadata + JSON columns for AI artifacts. |
| Containers | Docker Compose | One command to run everything locally. |
| CI | GitHub Actions | Lint, test, and build on every push and PR to `main` / `master`, plus a scheduled security audit. |

---

## Project layout

```
RepoInsight/
├── backend/
│   ├── app/
│   │   ├── api/endpoints/   # FastAPI routers (auth, repos, ai, chat, billing…)
│   │   ├── core/            # Config, crypto, startup self-check
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   ├── services/        # AI, embedding, GitHub, analytics, feature gating
│   │   ├── workers/         # Celery tasks
│   │   └── main.py          # ASGI entrypoint
│   ├── scripts/             # One-off maintenance scripts
│   ├── tests/
│   ├── alembic.ini          # Present for future migrations
│   ├── schema.sql           # Reference schema
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/             # Next.js App Router pages
│   │   ├── components/      # Reusable React components
│   │   ├── content/blog/    # Blog posts (TSX)
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # API client, helpers
│   │   └── styles/          # Tailwind + globals.css
│   ├── e2e/                 # Playwright tests
│   ├── public/
│   ├── Dockerfile
│   └── package.json
│
├── docs/
│   └── aws-deployment.md    # Full AWS walkthrough
│
├── .github/workflows/       # ci.yml, security-audit.yml
├── assets/                  # Logo and README artwork
├── .env.example
├── docker-compose.yml
├── LICENSE
└── README.md
```

---

## Deployment

A complete walkthrough for AWS (ECS Fargate + RDS + ElastiCache) lives in
[`docs/aws-deployment.md`](docs/aws-deployment.md). It covers IAM policies, task
definitions, ALB rules, Route 53, monitoring, and a cost estimate.

Deployment is a manual step today — the GitHub Actions workflows run lint, tests,
and the security audit, but do not push to AWS.

---

## Responsible disclosure

If you discover a security issue, please email **security@repoinsight.ai** rather
than opening a public issue. Reports are acknowledged as quickly as possible, and
verified critical issues are prioritized above other work.

---

## License

Proprietary. © Darel Rodriguez. All rights reserved.

This source is published for reference only. You may not copy, modify, redistribute,
or use this code in your own projects without explicit written permission from the
author. See [LICENSE](LICENSE) for the full text.
