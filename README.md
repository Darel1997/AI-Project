# RepoInsight AI

**AI-powered codebase intelligence platform.** Connect your GitHub repos, chat with your code, auto-generate docs, detect tech debt, and generate engineering tasks — all from one dashboard.

![License](https://img.shields.io/badge/license-MIT-blue)
![Python](https://img.shields.io/badge/python-3.11+-green)
![Next.js](https://img.shields.io/badge/next.js-14-black)
![Docker](https://img.shields.io/badge/docker-ready-blue)

---

## What It Does

RepoInsight AI ingests your GitHub repositories, chunks and embeds every source file into a vector database, then exposes a suite of AI-powered tools on top of that indexed codebase:

| Feature | Description |
|---|---|
| **Chat with Repo** | Ask natural-language questions about any file, module, or pattern in your codebase. RAG-powered answers cite specific files and line numbers. |
| **Auto Documentation** | Generate README sections, module-level docstrings, and architecture overviews from raw source. |
| **Tech Debt Scanner** | Detect code smells, complexity hotspots, missing tests, and stale dependencies. |
| **Task Generator** | Produce Jira-style tickets with title, description, priority, difficulty, and suggested files to modify. |
| **Analytics Dashboard** | Visualize commit frequency, contributor load, language breakdown, and a composite repo health score. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Next.js Frontend                     │
│         Dashboard · Chat · Analytics · Auth              │
└──────────────────────┬───────────────────────────────────┘
                       │ REST (JWT)
┌──────────────────────▼───────────────────────────────────┐
│                   FastAPI Backend                         │
│   Auth · Repos · AI Services · Analytics · Webhooks      │
├──────────┬────────────┬──────────┬───────────────────────┤
│ Postgres │  ChromaDB  │  Redis   │  Celery Workers       │
│ (data)   │ (vectors)  │ (cache/  │  (indexing, AI jobs)  │
│          │            │  queue)  │                        │
└──────────┴────────────┴──────────┴───────────────────────┘
                       │
              ┌────────▼────────┐
              │   GitHub API    │
              │   OpenAI API    │
              └─────────────────┘
```

---

## Quick Start (One Command)

### Mac / Linux
```bash
git clone https://github.com/yourname/repoinsight-ai.git
cd repoinsight-ai
chmod +x setup.sh
./setup.sh
```

### Windows
```powershell
git clone https://github.com/yourname/repoinsight-ai.git
cd repoinsight-ai
.\setup.ps1
```

The setup script will check Docker is running, ask for your API keys, create the `.env` file, build all containers, and start the app. The whole thing takes about 5 minutes.

When it finishes you'll see:
- **App:** http://localhost:3000
- **API docs:** http://localhost:8000/docs

### What You Need Beforehand

1. **Docker Desktop** — [download here](https://www.docker.com/products/docker-desktop/). Install it, open it, wait for the whale icon to stop animating.
2. **OpenAI API key** — [get one here](https://platform.openai.com/api-keys). Free tier works.
3. **GitHub OAuth app** *(optional)* — [create one here](https://github.com/settings/developers). Set the callback URL to `http://localhost:3000/auth/github/callback`. If you skip this, you can still register with email/password.

### Manual Setup (If You Prefer)

```bash
cd repoinsight-ai
cp .env.example .env        # edit this file and add your keys
docker compose up --build    # builds + starts everything
```

---

## Local Development (No Docker)

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
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

### Workers

```bash
cd backend
celery -A app.workers.celery_app worker --loglevel=info
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key ones:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Powers all AI features |
| `GITHUB_CLIENT_ID` / `SECRET` | GitHub OAuth app credentials |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis for Celery + caching |
| `JWT_SECRET` | Signing key for auth tokens |

---

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React, Tailwind CSS, Recharts
- **Backend:** Python 3.11, FastAPI, SQLAlchemy, Alembic
- **AI/RAG:** OpenAI API (GPT-4o, text-embedding-3-small), ChromaDB
- **Queue:** Celery + Redis
- **Database:** PostgreSQL 15
- **Infra:** Docker Compose, GitHub Actions, AWS (ECS/RDS)

---

## Screenshots

> *Screenshots of the running application go here.*

| Dashboard | Chat | Analytics |
|---|---|---|
| ![dashboard](docs/screenshots/dashboard.png) | ![chat](docs/screenshots/chat.png) | ![analytics](docs/screenshots/analytics.png) |

---

## Resume Bullets

- Architected a full-stack AI SaaS platform (Next.js / FastAPI / PostgreSQL) that indexes GitHub repositories into a ChromaDB vector store and exposes RAG-powered chat, auto-documentation, tech debt detection, and Jira-style task generation
- Built a retrieval-augmented generation pipeline that chunks source files, generates OpenAI embeddings, and retrieves contextually relevant code snippets to answer natural-language questions with file-level citations
- Implemented GitHub OAuth + JWT authentication, background job processing with Celery/Redis, and a real-time analytics dashboard with Recharts visualizations of commit frequency, contributor load, and composite repo health scores
- Containerized the full stack (frontend, API, workers, Postgres, Redis, ChromaDB) with Docker Compose and automated CI/CD via GitHub Actions with lint, test, build, and deploy stages targeting AWS ECS

---

## License

MIT
