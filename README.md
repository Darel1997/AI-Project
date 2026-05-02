<div align="center">

# RepoInsight AI

**Codebase intelligence for engineering teams.**
Index any GitHub repository, then chat with it, document it, audit it, and ship faster — all from one workspace.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c6bff?style=flat-square)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com)
[![Built with Claude](https://img.shields.io/badge/AI-Anthropic_Claude-d97757?style=flat-square)](https://anthropic.com)

[Live demo](https://repoinsight.ai) · [Documentation](docs/) · [Changelog](frontend/src/app/changelog/page.tsx) · [Report a vulnerability](#responsible-disclosure)

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
10. [Contributing](#contributing)
11. [License](#license)

---

## What RepoInsight does

RepoInsight ingests a Git repository, chunks every source file, embeds those chunks into a vector store, and then layers a suite of AI products on top. Every answer it produces is grounded in your actual source — every claim cites the file and line range it came from.

| Capability | What you get |
| --- | --- |
| **Chat with your code** | Ask plain-English questions; get answers with clickable citations to specific files and line ranges. |
| **Auto documentation** | Module-level docs, architecture overviews, and onboarding guides regenerated on every push. |
| **Security scanner** | CWE-classified findings (hardcoded secrets, SQLi, XSS, auth flaws) with concrete remediation steps. |
| **Code quality audits** | Code smells, complexity hotspots, and missing-test reports — each finding ships with a suggested fix. |
| **Architecture maps** | Auto-drawn Mermaid diagrams of services, modules, and the dependencies between them. |
| **Task generation** | Jira-style tickets with priority, difficulty, and the exact files a developer should touch. |
| **Auto re-index on push** | GitHub webhooks (HMAC-verified, idempotent) keep every artifact fresh. |
| **Team workspaces** | Shared orgs, role-based access, audit logs, and SSO on the Team plan. |

> **No fabricated metrics.** Every claim on this README and on the marketing site is something the code actually does. Where a feature is on the roadmap (SOC 2, ISO 27001, etc.) we say so.

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
3. **Embed.** Local `sentence-transformers` (no embedding API costs, no third-party data egress).
4. **Persist.** Vectors land in ChromaDB; metadata in Postgres; both are written in batches of 10 to keep transactions short.
5. **Notify.** Progress is streamed back to the dashboard so you watch the index build live.

### Inference pipeline

For every user question, RepoInsight retrieves the top-k most relevant chunks, sends only those chunks to Claude (never the whole repo), and renders the response with inline citations back to the file and line range. Anthropic's zero-retention policy means your code is not stored or used for training.

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

### One-command install

**macOS / Linux**

```bash
git clone https://github.com/yourname/repoinsight-ai.git
cd repoinsight-ai
chmod +x setup.sh
./setup.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/yourname/repoinsight-ai.git
cd repoinsight-ai
.\setup.ps1
```

The setup script verifies Docker is running, prompts for your API keys, writes `.env`, builds every container, and starts the app. When it finishes you'll see:

- **App** — http://localhost:3000
- **API docs (OpenAPI)** — http://localhost:8000/docs

### Manual install

```bash
cp .env.example .env       # edit and fill in your keys
docker compose up --build  # build and start every service
```

### Troubleshooting

> **"Cannot reach the API server at http://localhost:8000"**
>
> This means the frontend is up but the backend isn't responding yet. Most of
> the time it's one of these:
>
> 1. **The API is still starting.** First-time builds take 30–60 seconds for the
>    Python image to install dependencies and run migrations. The new docker-compose
>    config waits for the API to report healthy before starting the frontend, so a
>    fresh `docker compose up` shouldn't show this error — but a partial `docker compose
>    restart frontend` can.
> 2. **The API crashed.** Run `docker compose ps` — the `api` service should say
>    `healthy`. If it says `unhealthy` or is missing, run `docker compose logs api --tail 50`
>    and look for the error.
> 3. **Missing `ANTHROPIC_API_KEY`.** The API will start and serve `/health`, but every
>    AI request will fail. Visit `http://localhost:8000/health/detail` to confirm.
> 4. **Port 8000 is taken.** Another process is bound to it. Either stop that process
>    or change the API's host port in `docker-compose.yml`.
>
> The frontend now shows a banner at the top of the auth and dashboard pages
> when the backend is unreachable, with a Retry button — you don't need to
> reload the page once the API recovers.

---

## Configuration

Every environment variable lives in `.env.example` with comments. The keys you must set:

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ✅ | Powers chat, audits, security scanning, and every AI artifact. |
| `JWT_SECRET` | ✅ | Signs auth tokens. Use a 32-byte random string. |
| `DATABASE_URL` | ✅ | Postgres connection string. The default works inside Docker. |
| `REDIS_URL` | ✅ | Used by Celery and the rate limiter. The default works inside Docker. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional | GitHub OAuth app credentials. Required for private repos. |
| `STRIPE_SECRET_KEY` | Optional | Required only if you're enabling paid plans. |
| `NEXT_PUBLIC_API_URL` | Optional | Defaults to `http://localhost:8000`. |

> **Heads-up.** RepoInsight uses **Anthropic Claude**, not OpenAI. There is no `OPENAI_API_KEY` anywhere in the codebase. If you see a guide telling you to set one, it is out of date.

---

## Local development

If you'd rather skip Docker and run the services on your host, here's the path:

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

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
| Backend | Python 3.11, FastAPI, SQLAlchemy 2, Alembic | Async-first, type-safe, automatic OpenAPI. |
| AI / RAG | Anthropic Claude, sentence-transformers, ChromaDB | Zero-retention inference, local embeddings, no data egress for indexing. |
| Queue | Celery + Redis | Battle-tested for long-running indexing jobs. |
| Database | PostgreSQL 15 | Relational metadata + JSON columns for AI artifacts. |
| Containers | Docker Compose | One command to run everything locally. |
| CI/CD | GitHub Actions → AWS ECS | Lint, test, build, deploy on every push to `main`. |

---

## Project layout

```
repoinsight-ai/
├── backend/
│   ├── app/
│   │   ├── api/             # FastAPI routers (auth, repos, ai, billing…)
│   │   ├── services/        # Business logic + AI service classes
│   │   ├── workers/         # Celery tasks
│   │   ├── models/          # SQLAlchemy models
│   │   └── main.py          # ASGI entrypoint
│   ├── alembic/             # Database migrations
│   ├── tests/
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
│   └── package.json
│
├── docs/                    # Long-form documentation
│   └── aws-deployment.md
│
├── docker-compose.yml
├── setup.sh / setup.ps1     # One-command bootstrap
└── README.md
```

---

## Deployment

A complete walkthrough for AWS (ECS Fargate + RDS + ElastiCache) lives in [`docs/aws-deployment.md`](docs/aws-deployment.md). It includes IAM policies, task definitions, ALB rules, Route 53, monitoring, and a cost estimate.

---

## Responsible disclosure

If you discover a security issue, please email **security@repoinsight.ai** instead of opening a public issue. We respond within 24 hours and aim to ship a fix for verified critical issues within 72 hours. The site also exposes a `security.txt` at `/.well-known/security.txt` per RFC 9116.

---

## Contributing

Contributions are welcome. Before opening a pull request:

1. Run `pytest` (backend) and `npm test` (frontend) and make sure both are green.
2. Run `ruff check` and `npm run lint` — CI will run them anyway.
3. Open an issue to discuss any non-trivial change before sinking serious time into it.

---

## License

[MIT](LICENSE) — do whatever you want, just don't blame us if it breaks.
