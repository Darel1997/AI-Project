"""
Analytics service — computes derived metrics for the dashboard.

Combines data from the database (stored files, metadata) with
live GitHub API calls (commits, contributors) to produce
the health score and chart data.
"""

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.repository import Repository, RepoFile
from app.services.github_service import GitHubService

logger = logging.getLogger("repoinsight.analytics")


class AnalyticsService:

    @staticmethod
    async def compute_health_score(repo: Repository) -> float:
        """
        Computes a 0-100 health score based on multiple signals.
        Weights are intentionally simple and transparent.
        """
        score = 50.0  # start at neutral

        # recent activity (more commits in the last 90 days = healthier)
        if repo.total_commits > 100:
            score += 10
        elif repo.total_commits > 20:
            score += 5

        # contributor diversity
        if repo.total_contributors >= 5:
            score += 10
        elif repo.total_contributors >= 2:
            score += 5

        # documentation (has a README, has markdown files)
        if repo.description:
            score += 5

        # issue backlog (fewer open issues relative to size = healthier)
        if repo.total_files > 0:
            issue_ratio = repo.open_issues / max(repo.total_files, 1)
            if issue_ratio < 0.1:
                score += 10
            elif issue_ratio < 0.3:
                score += 5

        # stars as a proxy for community validation
        if repo.stars > 100:
            score += 10
        elif repo.stars > 10:
            score += 5

        return min(100.0, max(0.0, score))

    @staticmethod
    async def get_commit_activity(
        github: GitHubService, owner: str, repo_name: str
    ) -> List[dict]:
        """
        Fetches recent commits and buckets them by day for the
        last 30 days. Returns a list of {date, count} dicts.
        """
        commits = await github.get_commits(owner, repo_name, per_page=100)

        # count commits per day
        day_counts = Counter()
        for commit in commits:
            date_str = commit.get("commit", {}).get("author", {}).get("date", "")
            if date_str:
                day = date_str[:10]  # "2024-01-15"
                day_counts[day] += 1

        # build a complete 30-day series (fill zeros for days with no commits)
        today = datetime.now(timezone.utc).date()
        activity = []
        for i in range(30):
            day = (today - timedelta(days=29 - i)).isoformat()
            activity.append({"date": day, "count": day_counts.get(day, 0)})

        return activity

    @staticmethod
    async def get_contributor_stats(
        github: GitHubService, owner: str, repo_name: str
    ) -> List[dict]:
        """Fetches top contributors with their commit counts."""
        contributors = await github.get_contributors(owner, repo_name)
        return [
            {
                "username": c.get("login", "unknown"),
                "avatar_url": c.get("avatar_url"),
                "commits": c.get("contributions", 0),
                "additions": 0,   # would need per-commit stats for this
                "deletions": 0,
            }
            for c in contributors[:15]
        ]

    @staticmethod
    async def get_language_breakdown(
        github: GitHubService, owner: str, repo_name: str
    ) -> dict:
        """Returns language percentages for the repo."""
        languages = await github.get_languages(owner, repo_name)
        total = sum(languages.values()) or 1
        return {
            lang: round((bytes_ / total) * 100, 1)
            for lang, bytes_ in languages.items()
        }

    @staticmethod
    async def count_total_lines(db: AsyncSession, repo_id: int) -> int:
        result = await db.execute(
            select(func.sum(RepoFile.line_count)).where(RepoFile.repository_id == repo_id)
        )
        return result.scalar() or 0
