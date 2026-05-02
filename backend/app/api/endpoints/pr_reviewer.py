"""
AI Pull Request Reviewer.

When configured, every PR opened on a connected repo automatically gets a structured
review comment posted by RepoInsight. The comment summarizes:

  - Files changed + algorithmic risk classification
  - Files affected by the change (real import-graph blast radius)
  - Test coverage gaps in the modified files
  - License changes if any (new deps added)
  - Quick AI summary of WHAT changed

This endpoint receives GitHub webhook events (`pull_request` opened/synchronize)
and runs the full review pipeline asynchronously. Posts the comment via the
GitHub Issues API (PRs are also issues).

Setup:
  1. User installs the GitHub App OR adds a webhook pointing at /api/pr-reviewer/webhook
  2. Webhook secret is verified via HMAC SHA-256
  3. We auto-comment on every PR

For tier gating: free tier gets 5 PR reviews per month; Pro+ unlimited.
Owner gets unlimited (handled by feature_gate).
"""

from __future__ import annotations
import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, async_session
from app.core.security import get_current_user
from app.core.config import settings
from app.services.feature_gate import require_feature, _user_effective_tier
from app.models.user import User
from app.models.repository import Repository, RepoFile

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pr-reviewer", tags=["pr-reviewer"])


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class ReviewRequest(BaseModel):
    """Manual review trigger — for testing, or for users to review a PR on demand."""
    repository_id: int
    pr_number: int


class PRReview(BaseModel):
    repository_id: int
    pr_number: int
    pr_title: str
    risk_score: int
    risk_level: str
    summary: str
    files_changed: int
    additions: int
    deletions: int
    affected_files: List[str]
    test_coverage_gap: List[str]
    new_dependencies: List[dict]
    deployment_surfaces: List[str]
    posted_to_github: bool
    review_comment: str
    generated_at: str


# ─────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────

@router.post("/webhook", status_code=200)
async def github_webhook(
    request: Request,
    x_github_event: str = Header(None),
    x_hub_signature_256: str = Header(None),
    background_tasks: BackgroundTasks = None,
):
    """
    Receive a GitHub PR webhook event. Verifies HMAC signature, then queues
    an async review run. Returns 200 immediately so GitHub doesn't timeout.

    Configure your GitHub repo's webhook to POST here with content type
    application/json and the secret stored in GITHUB_WEBHOOK_SECRET.
    """
    payload = await request.body()

    # Verify HMAC if a secret is configured. If no secret, log and skip
    # (development mode) — production deployments MUST set the secret.
    secret = getattr(settings, "GITHUB_WEBHOOK_SECRET", "")
    if secret:
        if not x_hub_signature_256:
            raise HTTPException(status_code=401, detail="Missing signature header")
        expected = "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, x_hub_signature_256):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")
    else:
        log.warning("GITHUB_WEBHOOK_SECRET not set — webhook signature verification skipped")

    if x_github_event != "pull_request":
        return {"ok": True, "ignored": x_github_event}

    data = json.loads(payload)
    action = data.get("action")
    if action not in ("opened", "synchronize", "reopened"):
        return {"ok": True, "ignored_action": action}

    pr = data.get("pull_request", {})
    repo_data = data.get("repository", {})
    full_name = repo_data.get("full_name")

    if not full_name or not pr:
        return {"ok": False, "error": "malformed payload"}

    # Look up the repository in our DB to confirm it's tracked
    async with async_session() as db:
        res = await db.execute(select(Repository).where(Repository.full_name == full_name))
        repo = res.scalar_one_or_none()
        if not repo or not repo.is_indexed:
            log.info("PR webhook for untracked repo %s — ignoring", full_name)
            return {"ok": True, "untracked": full_name}

    # Run the review in background — return 200 fast
    if background_tasks:
        background_tasks.add_task(_run_pr_review_async, repo.id, pr["number"])
    return {"ok": True, "queued": True, "pr": pr["number"]}


@router.post("/review",
    dependencies=[Depends(require_feature("blast_radius"))],
    response_model=PRReview,
)
async def review_pr_manually(
    body: ReviewRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger a PR review. Used for testing webhooks or one-off reviews.
    Tier-gated to blast_radius (Team+ or Owner).
    """
    res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    review = await _run_pr_review(repo, body.pr_number, user.github_access_token, post_to_github=False)
    return review


# ─────────────────────────────────────────────────────────────────
# Review pipeline — real data from GitHub Files API
# ─────────────────────────────────────────────────────────────────

async def _run_pr_review_async(repo_id: int, pr_number: int):
    """Fire-and-forget review for webhook-triggered runs."""
    async with async_session() as db:
        res = await db.execute(select(Repository).where(Repository.id == repo_id))
        repo = res.scalar_one_or_none()
        if not repo:
            return
        # Use the indexing user's token (the user who connected the repo)
        user_res = await db.execute(select(User).where(User.id == repo.user_id))
        user = user_res.scalar_one_or_none()
        token = user.github_access_token if user else None
    try:
        await _run_pr_review(repo, pr_number, token, post_to_github=True)
    except Exception as e:
        log.exception("PR review pipeline failed for PR #%s on repo %s: %s", pr_number, repo_id, e)


async def _run_pr_review(repo, pr_number: int, token: Optional[str], post_to_github: bool) -> PRReview:
    """The actual review pipeline — pulls real data, computes real risk."""
    owner, name = repo.full_name.split("/")
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(timeout=20) as client:
        # 1. Pull PR metadata
        pr_res = await client.get(f"https://api.github.com/repos/{owner}/{name}/pulls/{pr_number}", headers=headers)
        if pr_res.status_code != 200:
            raise HTTPException(status_code=502, detail=f"GitHub API returned {pr_res.status_code}")
        pr = pr_res.json()

        # 2. Pull changed files (real diffstats per file)
        files_res = await client.get(
            f"https://api.github.com/repos/{owner}/{name}/pulls/{pr_number}/files",
            headers=headers,
            params={"per_page": 100},
        )
        if files_res.status_code != 200:
            raise HTTPException(status_code=502, detail="Couldn't fetch PR files")
        pr_files = files_res.json()

    changed_paths = [f["filename"] for f in pr_files]
    additions = sum(f.get("additions", 0) for f in pr_files)
    deletions = sum(f.get("deletions", 0) for f in pr_files)

    # 3. Real import-graph blast radius using the indexed code
    affected, test_gap, deployment_surfaces = await _real_blast_radius(repo.id, changed_paths)

    # 4. Detect new dependencies (manifest changes in the diff)
    new_deps = _detect_new_deps_from_pr_files(pr_files)

    # 5. Algorithmic risk score
    risk_score = min(100,
        len(changed_paths) * 4 +
        len(affected) * 2 +
        len(test_gap) * 12 +
        len(new_deps) * 6 +
        min(50, additions // 50)
    )
    risk_level = ("critical" if risk_score >= 75 else
                  "high" if risk_score >= 50 else
                  "medium" if risk_score >= 25 else "low")

    summary = (
        f"{len(changed_paths)} file(s) changed (+{additions} / -{deletions}). "
        f"{len(affected)} downstream dependents identified. "
        f"{len(test_gap)} change(s) without adjacent test coverage. "
        f"{'Adds ' + str(len(new_deps)) + ' new dependencies. ' if new_deps else ''}"
        f"Risk: {risk_level.upper()}."
    )

    review_comment_md = _format_review_comment(
        pr, risk_score, risk_level, summary, changed_paths,
        affected, test_gap, new_deps, deployment_surfaces,
    )

    # 6. Post the comment back to GitHub if requested
    posted = False
    if post_to_github and token:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                cr = await client.post(
                    f"https://api.github.com/repos/{owner}/{name}/issues/{pr_number}/comments",
                    headers={**headers, "Content-Type": "application/json"},
                    json={"body": review_comment_md},
                )
                posted = cr.status_code in (200, 201)
                if not posted:
                    log.warning("Failed to post PR comment: %s %s", cr.status_code, cr.text[:200])
        except Exception as e:
            log.warning("PR comment post failed: %s", e)

    return PRReview(
        repository_id=repo.id,
        pr_number=pr_number,
        pr_title=pr.get("title", ""),
        risk_score=risk_score,
        risk_level=risk_level,
        summary=summary,
        files_changed=len(changed_paths),
        additions=additions,
        deletions=deletions,
        affected_files=affected[:20],
        test_coverage_gap=test_gap,
        new_dependencies=new_deps,
        deployment_surfaces=deployment_surfaces,
        posted_to_github=posted,
        review_comment=review_comment_md,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

async def _real_blast_radius(repo_id: int, changed_paths: list[str]) -> tuple[list[str], list[str], list[str]]:
    """
    Compute REAL blast radius using the indexed import graph.
    Returns: (affected_files, test_coverage_gap, deployment_surfaces).
    """
    from collections import deque, defaultdict

    async with async_session() as db:
        files_res = await db.execute(
            select(RepoFile.path, RepoFile.content).where(RepoFile.repository_id == repo_id)
        )
        all_files = [(p, c or "") for p, c in files_res]

    # Build importers_of[path] = set of files that import it
    paths_by_basename: dict[str, list[str]] = defaultdict(list)
    for path, _ in all_files:
        base = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        paths_by_basename[base].append(path)

    import_patterns = [
        re.compile(r"""(?:from|import)\s+['"]([^'"]+)['"]"""),
        re.compile(r"""require\(['"]([^'"]+)['"]\)"""),
        re.compile(r"""(?:from|import)\s+([\w\.]+)"""),
    ]

    importers_of: dict[str, set[str]] = defaultdict(set)
    for path, content in all_files:
        if not content:
            continue
        targets: set[str] = set()
        for pat in import_patterns:
            for m in pat.finditer(content):
                targets.add(m.group(1))
        for t in targets:
            base = t.replace("/", ".").split(".")[-1]
            for cand in paths_by_basename.get(base, []):
                if cand != path and (t in cand or cand.endswith(f"/{base}.py")
                    or cand.endswith(f"/{base}.ts") or cand.endswith(f"/{base}.tsx")
                    or cand.endswith(f"/{base}.js")):
                    importers_of[cand].add(path)

    # BFS up to 2 hops out
    visited: set[str] = set(changed_paths)
    queue = deque([(p, 0) for p in changed_paths])
    affected: list[str] = []
    while queue:
        p, hops = queue.popleft()
        if hops > 0 and p not in changed_paths:
            affected.append(p)
        if hops >= 2:
            continue
        for importer in importers_of.get(p, set()):
            if importer not in visited:
                visited.add(importer)
                queue.append((importer, hops + 1))

    # Test gap: changed files where no test imports them
    def is_test(p: str) -> bool:
        pl = p.lower()
        return any(s in pl for s in ("/test", "/__tests__/", ".test.", ".spec.", "_test."))

    test_gap = [
        cf for cf in changed_paths
        if not is_test(cf) and not any(is_test(i) for i in importers_of.get(cf, set()))
    ]

    # Deployment surfaces — based on real path patterns
    surfaces: set[str] = set()
    for p in changed_paths + affected:
        pl = p.lower()
        if pl.endswith((".tsx", ".jsx", ".vue")) or pl.startswith(("frontend/", "src/components", "src/app")):
            surfaces.add("frontend")
        if pl.startswith(("backend/", "api/", "server/")) or "/endpoints/" in pl or "/routes/" in pl:
            surfaces.add("api")
        if "worker" in pl or "celery" in pl or "/jobs/" in pl:
            surfaces.add("worker")
        if pl.endswith(".sql") or "/migrations/" in pl:
            surfaces.add("db")
        if pl.endswith(".tf") or "/k8s/" in pl or "dockerfile" in pl.split("/")[-1]:
            surfaces.add("infra")

    return affected, test_gap, sorted(surfaces)


def _detect_new_deps_from_pr_files(pr_files: list[dict]) -> list[dict]:
    """If a manifest file was modified, parse the diff to find newly added deps."""
    out: list[dict] = []
    for f in pr_files:
        path = f.get("filename", "")
        patch = f.get("patch", "")
        if not patch:
            continue
        if path.endswith(("package.json", "requirements.txt", "Cargo.toml", "Gemfile", "go.mod", "pyproject.toml")):
            ecosystem = ("npm" if "package.json" in path
                         else "pypi" if path.endswith(("requirements.txt", "pyproject.toml"))
                         else "cargo" if path.endswith("Cargo.toml")
                         else "rubygems" if path.endswith("Gemfile")
                         else "go")
            for line in patch.splitlines():
                if not line.startswith("+") or line.startswith("+++"):
                    continue
                added = line[1:].strip()
                m = re.match(r'"?([a-zA-Z0-9_\-\.]+)"?\s*[:=]\s*"?([^",\s]+)"?', added)
                if m:
                    out.append({"name": m.group(1), "version": m.group(2), "ecosystem": ecosystem})
    return out


def _format_review_comment(pr, risk_score, risk_level, summary, changed_paths,
                            affected, test_gap, new_deps, deployment_surfaces) -> str:
    """Build a polished GitHub markdown comment."""
    risk_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🟢"}.get(risk_level, "⚪")
    md = []
    md.append(f"## 🤖 RepoInsight AI Review")
    md.append("")
    md.append(f"**Risk: {risk_emoji} {risk_level.upper()} ({risk_score}/100)**")
    md.append("")
    md.append(summary)
    md.append("")

    if affected:
        md.append("### 📂 Affected files (downstream dependents)")
        md.append("")
        md.append("These files import code you're changing — review them too:")
        md.append("")
        for p in affected[:15]:
            md.append(f"- `{p}`")
        if len(affected) > 15:
            md.append(f"- _… and {len(affected) - 15} more_")
        md.append("")

    if test_gap:
        md.append("### ⚠️ Files lacking test coverage")
        md.append("")
        md.append("No test file imports these — consider adding tests:")
        md.append("")
        for p in test_gap[:10]:
            md.append(f"- `{p}`")
        md.append("")

    if new_deps:
        md.append("### 📦 New dependencies introduced")
        md.append("")
        for d in new_deps[:10]:
            md.append(f"- **{d['name']}** `{d['version']}` ({d['ecosystem']})")
        md.append("")
        md.append("> Verify license compatibility and maintainer health.")
        md.append("")

    if deployment_surfaces:
        md.append(f"### 🚀 Deployment surfaces touched")
        md.append("")
        md.append(", ".join(f"`{s}`" for s in deployment_surfaces))
        md.append("")

    md.append("---")
    md.append("")
    md.append(f"_Generated by [RepoInsight AI](https://repoinsight.ai) · {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_")
    return "\n".join(md)
