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
    """
    import httpx
    from app.services.embedding_service import EmbeddingService
    from app.models.repository import Repository, RepoFile

    session = SyncSession()
    embedding_svc = EmbeddingService()

    try:
        repo = session.query(Repository).filter(Repository.id == repo_id).one()
        repo.index_status = "indexing"
        session.commit()

        owner, name = repo.full_name.split("/")
        headers = {
            "Authorization": f"Bearer {user_github_token}",
            "Accept": "application/vnd.github+json",
        }

        # fetch file tree
        tree_resp = httpx.get(
            f"https://api.github.com/repos/{owner}/{name}/git/trees/{repo.default_branch}",
            headers=headers,
            params={"recursive": "1"},
            timeout=30,
        )
        tree_resp.raise_for_status()
        tree = tree_resp.json().get("tree", [])
        blobs = [item for item in tree if item["type"] == "blob"]

        repo.total_files = len(blobs)
        session.commit()

        indexed = 0
        for item in blobs:
            path = item["path"]
            if not EmbeddingService.should_index(path):
                continue

            # download raw content
            content_resp = httpx.get(
                f"https://api.github.com/repos/{owner}/{name}/contents/{path}",
                headers={**headers, "Accept": "application/vnd.github.raw+json"},
                timeout=20,
            )
            if content_resp.status_code != 200 or len(content_resp.content) > 500_000:
                continue

            try:
                content = content_resp.text
            except UnicodeDecodeError:
                continue

            lines = content.count("\n") + 1
            filename = path.split("/")[-1]
            ext = filename.rsplit(".", 1)[-1] if "." in filename else ""

            # save file record to Postgres
            repo_file = RepoFile(
                repository_id=repo_id,
                path=path,
                filename=filename,
                language=ext,
                size_bytes=len(content.encode()),
                line_count=lines,
                content=content,
                sha=item.get("sha"),
                is_embedded=False,
            )
            session.add(repo_file)
            session.flush()

            # chunk + embed into ChromaDB
            try:
                chunk_count = embedding_svc.index_file(repo_id, path, content)
                if chunk_count > 0:
                    repo_file.is_embedded = True
                    indexed += 1
            except Exception as e:
                logger.warning(f"Failed to embed {path}: {e}")

            repo.indexed_files = indexed
            session.commit()

            # update task state for progress tracking
            self.update_state(
                state="INDEXING",
                meta={"indexed": indexed, "total": repo.total_files},
            )

        # done — compute summary stats
        repo.is_indexed = True
        repo.index_status = "done"
        repo.indexed_files = indexed
        repo.total_lines = sum(f.line_count for f in repo.files)
        session.commit()

        logger.info(f"Finished indexing repo {repo.full_name}: {indexed} files embedded")
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
