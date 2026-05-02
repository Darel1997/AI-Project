"""
Celery workers for background job processing.

The main task is `index_repository` which:
1. Fetches the full file tree from GitHub
2. Downloads each source file
3. Chunks and embeds the content into ChromaDB
4. Updates the repo status in Postgres

This runs outside the FastAPI request cycle so imports
don't create issues.
"""

import logging
import os

from celery import Celery
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.services.quality_score import compute_quality_score

logger = logging.getLogger("repoinsight.worker")

# ── Celery app ────────────────────────────────────────────────────

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
DATABASE_URL_SYNC = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://repoinsight:repoinsight@db:5432/repoinsight",
)

celery_app = Celery("repoinsight", broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# synchronous DB session for Celery tasks (can't use asyncio here)
sync_engine = create_engine(DATABASE_URL_SYNC)
SyncSession = sessionmaker(bind=sync_engine)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def index_repository(self, repo_id: int, user_github_token: str):
    """
    Background task: fetches all files from GitHub,
    chunks + embeds them into ChromaDB, updates Postgres.

    Performance design:
      - Filter by should_index() BEFORE any network call (skip images, binaries, lockfiles)
      - Use GitHub's Git Blobs API (tree SHA → blob SHA → raw content) instead of
        the slower contents API that requires a separate call per file
      - Commit Postgres every 10 files, not every file (90% fewer round-trips)
      - Preload the embedding model ONCE at task start so the first file isn't slow
      - Emit Celery progress on every file so the frontend progress bar moves
    """
    import base64
    import httpx
    from app.services.embedding_service import EmbeddingService
    # Force-register all FK target tables with SQLAlchemy's metadata. Even though
    # this task only writes Repository/RepoFile, SQLAlchemy resolves foreign keys
    # at flush time — so if 'organizations' isn't in the registry when we commit,
    # the repositories.organization_id FK fails with NoReferencedTableError.
    from app.models.user import User  # noqa: F401
    from app.models.organization import Organization, Membership, Invitation  # noqa: F401
    from app.models.subscription import Subscription  # noqa: F401
    from app.models.chat import ChatMessage, Task  # noqa: F401
    from app.models.repository import Repository, RepoFile

    session = SyncSession()
    embedding_svc = EmbeddingService()

    try:
        # ── Preload embedding model ──
        # The first call to generate_embeddings() triggers a 30-60s model download
        # on a fresh container. Doing it here (BEFORE we mark status='indexing')
        # means the user's UI doesn't show "indexing 0/127" for a minute
        # while the model warms up.
        logger.info(f"[repo {repo_id}] warming embedding model…")
        embedding_svc.generate_embeddings(["warmup"])
        logger.info(f"[repo {repo_id}] model ready")

        repo = session.query(Repository).filter(Repository.id == repo_id).one()
        repo.index_status = "indexing"
        session.commit()

        owner, name = repo.full_name.split("/")
        headers = {"Accept": "application/vnd.github+json"}
        if user_github_token:
            headers["Authorization"] = f"Bearer {user_github_token}"

        # ── Refresh repo metadata ──
        try:
            meta_resp = httpx.get(
                f"https://api.github.com/repos/{owner}/{name}",
                headers=headers,
                timeout=15,
            )
            if meta_resp.status_code == 200:
                meta = meta_resp.json()
                repo.stars = meta.get("stargazers_count", repo.stars)
                repo.forks = meta.get("forks_count", repo.forks)
                repo.open_issues = meta.get("open_issues_count", repo.open_issues)
                repo.description = meta.get("description", repo.description)
                repo.language = meta.get("language", repo.language)
                session.commit()
        except Exception as e:
            logger.warning(f"Could not refresh repo metadata: {e}")

        # ── Fetch full tree (one call) ──
        tree_resp = httpx.get(
            f"https://api.github.com/repos/{owner}/{name}/git/trees/{repo.default_branch}",
            headers=headers,
            params={"recursive": "1"},
            timeout=30,
        )
        tree_resp.raise_for_status()
        tree = tree_resp.json().get("tree", [])
        all_blobs = [item for item in tree if item["type"] == "blob"]

        # Filter BEFORE fetching — skip images, binaries, minified bundles, lockfiles
        indexable_blobs = [
            b for b in all_blobs
            if EmbeddingService.should_index(b["path"]) and b.get("size", 0) <= 2_000_000
        ]
        repo.total_files = len(indexable_blobs)
        session.commit()

        logger.info(
            f"[repo {repo_id}] tree has {len(all_blobs)} blobs, {len(indexable_blobs)} indexable"
        )

        # Emit an initial progress update so the frontend bar moves off 0 immediately
        self.update_state(
            state="INDEXING",
            meta={"indexed": 0, "total": len(indexable_blobs), "stage": "fetching"},
        )

        # ── Fetch + embed each file ──
        indexed = 0
        commit_batch = 0
        COMMIT_EVERY = 10

        for item in indexable_blobs:
            path = item["path"]
            blob_sha = item.get("sha")
            if not blob_sha:
                continue

            # Fetch blob by SHA (faster than /contents/ and works for any path,
            # including ones with special chars). Returns base64 content by default.
            try:
                blob_resp = httpx.get(
                    f"https://api.github.com/repos/{owner}/{name}/git/blobs/{blob_sha}",
                    headers=headers,
                    timeout=20,
                )
                if blob_resp.status_code != 200:
                    continue
                blob_data = blob_resp.json()
                encoded = blob_data.get("content", "")
                encoding = blob_data.get("encoding", "base64")

                if encoding == "base64":
                    raw = base64.b64decode(encoded)
                else:
                    raw = encoded.encode() if isinstance(encoded, str) else encoded

                try:
                    content = raw.decode("utf-8")
                except UnicodeDecodeError:
                    # Binary or non-UTF-8 — skip silently
                    continue
            except Exception as e:
                logger.warning(f"[repo {repo_id}] fetch blob failed {path}: {e}")
                continue

            lines = content.count("\n") + 1
            filename = path.split("/")[-1]
            ext = filename.rsplit(".", 1)[-1] if "." in filename else ""

            # Upsert file record (no commit yet — batched below)
            repo_file = RepoFile(
                repository_id=repo_id,
                path=path,
                filename=filename,
                language=ext,
                size_bytes=len(content.encode()),
                line_count=lines,
                content=content,
                sha=blob_sha,
                is_embedded=False,
            )
            session.add(repo_file)
            session.flush()

            # Embed into ChromaDB
            try:
                chunk_count = embedding_svc.index_file(repo_id, path, content)
                if chunk_count > 0:
                    repo_file.is_embedded = True
                    indexed += 1
            except Exception as e:
                logger.warning(f"[repo {repo_id}] embed failed {path}: {e}")

            commit_batch += 1
            # Commit every N files — ~90% fewer round trips to Postgres than
            # committing after each file. The occasional lost-in-crash file is
            # fine here; the user can re-trigger indexing.
            if commit_batch >= COMMIT_EVERY:
                repo.indexed_files = indexed
                session.commit()
                commit_batch = 0

            # Update progress on every file — cheap and keeps the UI responsive
            self.update_state(
                state="INDEXING",
                meta={"indexed": indexed, "total": len(indexable_blobs), "stage": "embedding"},
            )

        # ── Done — compute summary stats ──
        repo.is_indexed = True
        repo.index_status = "done"
        repo.indexed_files = indexed
        repo.total_lines = sum(f.line_count for f in repo.files)
        repo.health_score = compute_quality_score(repo, files=list(repo.files))
        session.commit()

        logger.info(
            f"[repo {repo_id}] FINISHED: {indexed}/{len(indexable_blobs)} files embedded, "
            f"health={repo.health_score:.1f}"
        )
        return {"repo_id": repo_id, "indexed_files": indexed}

    except Exception as exc:
        session.rollback()
        # update status to failed
        try:
            repo = session.query(Repository).filter(Repository.id == repo_id).one()
            repo.index_status = "failed"
            session.commit()
        except Exception:
            pass
        logger.error(f"Indexing failed for repo {repo_id}: {exc}")
        raise self.retry(exc=exc)

    finally:
        session.close()


