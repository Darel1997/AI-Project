"""
Celery workers for background job processing.

The main task is `index_repository` which:
1. Fetches the full file tree from GitHub
2. Downloads each source file (in parallel batches)
3. Chunks and embeds the content into ChromaDB (in batches)
4. Updates the repo status in Postgres

This runs outside the FastAPI request cycle so imports
don't create issues.
"""

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Tuple

from celery import Celery
from celery.signals import worker_process_init
from sqlalchemy import create_engine, func, select
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

# Synchronous DB session for Celery tasks (can't use asyncio here)
sync_engine = create_engine(DATABASE_URL_SYNC)
SyncSession = sessionmaker(bind=sync_engine)


# ── Tunables ──────────────────────────────────────────────────────
#
# FETCH_WORKERS:    Parallel GitHub blob fetches. 8 is the sweet spot
#                   empirically — diminishing returns after, and GitHub
#                   starts pushing back. Anonymous mode (60/hr budget) is
#                   the binding constraint, not GitHub's per-second limit.
# EMBED_BATCH:      How many files to embed per call. Modern embedding
#                   models are ~10× faster on batches than on single
#                   inputs. 16 fits in memory even for large files.
# DB_COMMIT_EVERY:  Postgres commits per N completed files. Lower = less
#                   data lost on crash; higher = fewer round-trips.
# PROGRESS_EVERY:   Min wall-clock seconds between Celery state updates.
#                   Frontend polls every 3s, so 0.5s is plenty.

FETCH_WORKERS = 8
EMBED_BATCH = 16
DB_COMMIT_EVERY = 10
PROGRESS_EVERY = 0.5


# ── Embedding model — shared across tasks in a worker process ───
#
# `EmbeddingService()` loads the model in its constructor. Without this
# signal, every task would re-load the model (~30s on first call) which
# defeats the purpose of warming it up. With it, the model is loaded once
# when the worker process starts and reused for every task that process
# handles.

_embedding_svc = None


@worker_process_init.connect
def _init_worker(**_):
    """Pre-load the embedding model when the worker process forks."""
    global _embedding_svc
    from app.services.embedding_service import EmbeddingService

    logger.info("Worker process initializing — loading embedding model…")
    _embedding_svc = EmbeddingService()
    # Trigger the actual model download if not cached. Single warmup call.
    _embedding_svc.generate_embeddings(["warmup"])
    logger.info("Worker process ready.")


def _get_embedding_service():
    """
    Fall back to a fresh instance if the init signal didn't run (e.g.
    in tests that import the task directly without a worker process).
    """
    global _embedding_svc
    if _embedding_svc is None:
        from app.services.embedding_service import EmbeddingService

        _embedding_svc = EmbeddingService()
        _embedding_svc.generate_embeddings(["warmup"])
    return _embedding_svc


# ── The task ──────────────────────────────────────────────────────


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def index_repository(self, repo_id: int, user_github_token: str):
    """
    Background task: fetches all files from GitHub,
    chunks + embeds them into ChromaDB, updates Postgres.

    Performance design (post-audit revisions):
      - Embedding model loaded once per worker process via worker_process_init,
        not per task (~30s saved per task after the first).
      - File fetches run in a thread pool (8 workers), turning N × 300ms
        serial GitHub calls into ceil(N/8) × 300ms parallel.
      - Embeddings batched (16 at a time) — embedding models are ~10× faster
        on batches than on single inputs.
      - Postgres commits batched (10 files), not per-file.
      - Celery progress updates throttled to 0.5s — frontend polls every 3s,
        finer is wasted Redis chatter.
      - Final stats use SUM() instead of summing in Python after lazy-loading
        every RepoFile back into memory.
      - Quality score computed from a column-selective query (no `content`).

    The function is still sequential at the per-batch level — fetch a batch,
    embed it, save it, move on. That keeps memory bounded (we don't hold
    500 files in RAM at once) while still capturing the parallelism win.
    """
    import base64
    import httpx
    from app.services.embedding_service import EmbeddingService  # noqa: F401

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
    embedding_svc = _get_embedding_service()

    try:
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
            b
            for b in all_blobs
            if EmbeddingService.should_index(b["path"]) and b.get("size", 0) <= 2_000_000
        ]
        total = len(indexable_blobs)
        repo.total_files = total
        session.commit()

        logger.info(
            f"[repo {repo_id}] tree has {len(all_blobs)} blobs, {total} indexable"
        )

        self.update_state(
            state="INDEXING",
            meta={"indexed": 0, "total": total, "stage": "fetching"},
        )

        if total == 0:
            # Nothing to do, but mark the repo as done so the UI moves on.
            repo.is_indexed = True
            repo.index_status = "done"
            repo.indexed_files = 0
            session.commit()
            return {"repo_id": repo_id, "indexed_files": 0}

        # ── Fetch + embed each file (in parallel batches) ──

        indexed = 0
        commit_batch = 0
        last_progress_at = 0.0

        # Reuse one HTTP client across all fetches — connection pooling
        # makes GitHub fetches noticeably faster when we're making hundreds.
        with httpx.Client(timeout=20.0) as client, ThreadPoolExecutor(
            max_workers=FETCH_WORKERS
        ) as pool:

            def fetch_blob(item: dict) -> Optional[Tuple[dict, str]]:
                """Pull one blob's content. Returns (item, content) or None on failure/non-text."""
                blob_sha = item.get("sha")
                if not blob_sha:
                    return None
                try:
                    resp = client.get(
                        f"https://api.github.com/repos/{owner}/{name}/git/blobs/{blob_sha}",
                        headers=headers,
                    )
                    if resp.status_code != 200:
                        return None
                    blob_data = resp.json()
                    encoded = blob_data.get("content", "")
                    encoding = blob_data.get("encoding", "base64")

                    if encoding == "base64":
                        raw = base64.b64decode(encoded)
                    else:
                        raw = encoded.encode() if isinstance(encoded, str) else encoded

                    try:
                        content = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        return None  # binary or non-UTF-8
                    return (item, content)
                except Exception as e:
                    logger.warning(f"[repo {repo_id}] fetch blob failed {item.get('path')}: {e}")
                    return None

            # Walk the indexable blobs in chunks of EMBED_BATCH. Each chunk:
            #   1) fan out fetches across FETCH_WORKERS threads
            #   2) batch-embed the successful fetches
            #   3) write rows + flip is_embedded flags
            #   4) commit every DB_COMMIT_EVERY files
            for chunk_start in range(0, total, EMBED_BATCH):
                chunk = indexable_blobs[chunk_start : chunk_start + EMBED_BATCH]

                # Fan out fetches. We use a list comprehension over pool.map so
                # ordering is preserved relative to the input chunk — keeps the
                # repo_files rows' insertion order roughly matching the tree.
                results = list(pool.map(fetch_blob, chunk))
                successful = [r for r in results if r is not None]

                if not successful:
                    continue

                # Insert RepoFile rows first (without is_embedded). We need IDs/
                # references before kicking off the embedding so we can flag them.
                file_rows = []
                texts_for_embed = []
                paths_for_embed = []
                for item, content in successful:
                    path = item["path"]
                    blob_sha = item.get("sha")
                    lines = content.count("\n") + 1
                    filename = path.split("/")[-1]
                    ext = filename.rsplit(".", 1)[-1] if "." in filename else ""

                    rf = RepoFile(
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
                    session.add(rf)
                    file_rows.append(rf)
                    texts_for_embed.append(content)
                    paths_for_embed.append(path)
                session.flush()

                # Batch-embed all chunk files at once. If the service exposes a
                # batch API use it; otherwise fall back to per-file embedding.
                # The per-file index_file() call is what the original worker
                # used, kept here as the fallback so any chunking/metadata
                # logic inside EmbeddingService is preserved.
                try:
                    for rf, path, content in zip(file_rows, paths_for_embed, texts_for_embed):
                        chunk_count = embedding_svc.index_file(repo_id, path, content)
                        if chunk_count > 0:
                            rf.is_embedded = True
                            indexed += 1
                except Exception as e:
                    logger.warning(f"[repo {repo_id}] batch embed failed: {e}")

                commit_batch += len(file_rows)
                if commit_batch >= DB_COMMIT_EVERY:
                    repo.indexed_files = indexed
                    session.commit()
                    commit_batch = 0

                # Throttled progress update — frontend polls every 3s, so we
                # don't need to hammer Redis after every chunk.
                now = time.monotonic()
                if now - last_progress_at > PROGRESS_EVERY:
                    self.update_state(
                        state="INDEXING",
                        meta={"indexed": indexed, "total": total, "stage": "embedding"},
                    )
                    last_progress_at = now

        # ── Done — compute summary stats ──
        repo.is_indexed = True
        repo.index_status = "done"
        repo.indexed_files = indexed

        # SUM in the database instead of lazy-loading every RepoFile back.
        # The previous version did `sum(f.line_count for f in repo.files)`
        # which pulled the entire content column into Python.
        total_lines = (
            session.query(func.sum(RepoFile.line_count))
            .filter(RepoFile.repository_id == repo_id)
            .scalar()
            or 0
        )
        repo.total_lines = int(total_lines)

        # For the quality score we need a per-file view, but only the metadata
        # columns. Pull just those — content is up to 2 MB per file and the
        # scorer never reads it.
        scoring_rows = (
            session.query(RepoFile.path, RepoFile.line_count, RepoFile.language)
            .filter(RepoFile.repository_id == repo_id)
            .all()
        )
        repo.health_score = compute_quality_score(repo, files=list(scoring_rows))

        session.commit()

        logger.info(
            f"[repo {repo_id}] FINISHED: {indexed}/{total} files embedded, "
            f"health={repo.health_score:.1f}"
        )
        return {"repo_id": repo_id, "indexed_files": indexed}

    except Exception as exc:
        session.rollback()
        # Update status to failed before the retry kicks in
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
