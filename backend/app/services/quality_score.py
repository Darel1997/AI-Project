"""
Quality Score — canonical formula used by the indexer AND the analytics endpoint.

Formerly two separate computations (heuristic in worker, community-focused in analytics)
which produced different numbers for the same repo. Now unified so the dashboard and
analytics page always show the same value.

The score blends TWO dimensions:
  - Code structure  (file sizes, test coverage ratio, documentation presence)
  - Project health  (contributors, commit activity, open-issue ratio)

Range: 0-100. Higher = better-maintained, well-structured, actively developed.

The score is stored once on the Repository row at indexing time. Analytics
reads the stored value — it does NOT recompute. This guarantees consistency.
"""

from __future__ import annotations
from typing import Literal


def compute_quality_score(repo, files: list | None = None) -> float:
    """
    Compute a 0-100 Quality Score for a repository.

    `files` is the list of RepoFile rows for this repo. Passed explicitly because
    accessing repo.files from async context can lazy-load and cause issues.
    If omitted we'll try `repo.files` (works in sync contexts like the Celery worker).
    """
    if files is None:
        files = list(getattr(repo, "files", []) or [])

    score = 50.0  # neutral baseline

    # ═════════════════════════════════════════════════════════════
    # DIMENSION 1: CODE STRUCTURE  (±35 points)
    # ═════════════════════════════════════════════════════════════

    if files:
        # — Average file size — reasonable modules beat bloated god-files
        avg_lines = sum(f.line_count for f in files) / len(files)
        if avg_lines > 600:    score -= 10
        elif avg_lines > 400:  score -= 5
        elif 50 <= avg_lines <= 300:  score += 3   # sweet spot
        elif avg_lines < 10:   score -= 3

        # — Largest file — penalize god-objects
        max_lines = max((f.line_count for f in files), default=0)
        if max_lines > 2000:   score -= 8
        elif max_lines > 1000: score -= 4

        # — Tests — ratio of test files to total files
        test_files = sum(
            1 for f in files
            if ("test" in f.path.lower() or "spec" in f.path.lower()
                or "/__tests__/" in f.path.lower())
        )
        test_ratio = test_files / len(files) if files else 0
        if test_ratio >= 0.25:   score += 10
        elif test_ratio >= 0.1:  score += 5
        elif test_ratio == 0:    score -= 8

        # — Documentation — README present, additional markdown docs
        has_readme = any(
            f.path.lower() in ("readme.md", "readme.txt", "readme.rst")
            or f.path.lower().startswith("readme.")
            for f in files
        )
        if has_readme: score += 4

        doc_files = sum(1 for f in files if f.path.lower().endswith(".md"))
        if doc_files >= 3: score += 3

        # — Project size sanity —
        if len(files) < 3:
            score -= 8   # barely a project
        elif len(files) > 500:
            score -= 3   # sprawl

    # ═════════════════════════════════════════════════════════════
    # DIMENSION 2: PROJECT HEALTH  (±25 points)
    # ═════════════════════════════════════════════════════════════

    # — Commit activity — proxy for "is this alive?"
    total_commits = getattr(repo, "total_commits", 0) or 0
    if total_commits > 100:   score += 6
    elif total_commits > 20:  score += 3

    # — Contributor diversity — bus factor
    total_contributors = getattr(repo, "total_contributors", 0) or 0
    if total_contributors >= 5:    score += 6
    elif total_contributors >= 2:  score += 3

    # — Issue backlog — too many open issues relative to codebase size
    open_issues = getattr(repo, "open_issues", 0) or 0
    total_files = getattr(repo, "total_files", 0) or 0
    if total_files > 0:
        issue_ratio = open_issues / max(total_files, 1)
        if issue_ratio < 0.1:     score += 5
        elif issue_ratio < 0.3:   score += 2
        elif issue_ratio > 1.0:   score -= 3

    # — Community signal via stars — light bonus (not a big swing)
    stars = getattr(repo, "stars", 0) or 0
    if stars > 1000:    score += 5
    elif stars > 100:   score += 3
    elif stars > 10:    score += 1

    # — Has a description — basic metadata hygiene
    if getattr(repo, "description", None):
        score += 2

    # Clamp
    return round(max(0.0, min(100.0, score)), 1)


# ─────────────────────────────────────────────────────────────────
# Score → label + color for UI rendering
# ─────────────────────────────────────────────────────────────────

QualityLabel = Literal["excellent", "good", "fair", "needs_work", "poor"]


def quality_label(score: float | None) -> QualityLabel:
    """
    Plain-English label for a score. Use this instead of raw numbers when
    talking to non-engineers.

      85+     Excellent
      70-84   Good
      55-69   Fair
      35-54   Needs work
      0-34    Poor
    """
    if score is None: return "fair"
    if score >= 85: return "excellent"
    if score >= 70: return "good"
    if score >= 55: return "fair"
    if score >= 35: return "needs_work"
    return "poor"
