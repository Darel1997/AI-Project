"""
GitHub API integration service.

Handles all communication with the GitHub REST API:
fetching repo metadata, file trees, raw file content,
commit history, and contributor stats.
"""

import logging
import secrets
from typing import Optional, List, Tuple
from urllib.parse import urlparse, urlencode

import httpx

from app.core.config import settings
from app.core.redis import get_redis

logger = logging.getLogger("repoinsight.github")

GITHUB_API = "https://api.github.com"
GITHUB_OAUTH_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# How long a generated OAuth state token is valid for. Long enough for a
# slow human to complete consent, short enough that abandoned flows don't
# pile up in Redis or extend a CSRF attack window.
OAUTH_STATE_TTL_SECONDS = 600  # 10 minutes


class GitHubService:
    """Stateless wrapper around GitHub's REST API."""

    def __init__(self, access_token: Optional[str] = None):
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if access_token:
            self.headers["Authorization"] = f"Bearer {access_token}"

    # ── OAuth flow ────────────────────────────────────────────────

    @staticmethod
    async def get_oauth_url() -> Tuple[str, str]:
        """
        Build the GitHub authorize URL with a fresh single-use `state`.

        Returns (url, state). Callers should store the state alongside the
        in-flight flow (we use Redis here) and verify it on callback to
        defend against OAuth CSRF (RFC 6749 §10.12).

        The state is opaque to GitHub — it just round-trips it back to us
        on the callback URL.
        """
        state = secrets.token_urlsafe(32)
        try:
            redis = await get_redis()
            # The value is a marker; we only need to know the state exists
            # and hasn't been used yet. SETEX gives single-use expiry.
            await redis.setex(_oauth_state_key(state), OAUTH_STATE_TTL_SECONDS, "1")
        except Exception as e:
            # If Redis is down we still want sign-in to work, but without
            # CSRF protection. Log loudly. In production the startup check
            # ensures Redis is reachable.
            logger.error("Could not persist OAuth state to Redis: %s — proceeding without CSRF protection", e)

        params = {
            "client_id": settings.GITHUB_CLIENT_ID,
            "scope": "repo,read:user,user:email",
            "redirect_uri": f"{settings.FRONTEND_URL}/auth/github/callback",
            "state": state,
        }
        url = f"{GITHUB_OAUTH_URL}?{urlencode(params)}"
        return url, state

    @staticmethod
    async def consume_oauth_state(state: str) -> bool:
        """
        Verify that `state` was issued by `get_oauth_url` and hasn't been
        used yet. Returns True if valid; deletes the key as a side effect
        so a replay of the same callback URL doesn't pass twice.
        """
        if not state:
            return False
        try:
            redis = await get_redis()
            # DEL returns the number of keys removed. If the state was set,
            # it returns 1. If it expired or never existed, 0.
            removed = await redis.delete(_oauth_state_key(state))
            return bool(removed)
        except Exception as e:
            logger.error("Could not consume OAuth state from Redis: %s", e)
            # Fail closed when Redis is unreachable — better to make the user
            # retry than accept an unverified callback.
            return False

    @staticmethod
    async def exchange_code_for_token(code: str) -> dict:
        """Exchange the OAuth callback code for an access token."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GITHUB_TOKEN_URL,
                json={
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "client_secret": settings.GITHUB_CLIENT_SECRET,
                    "code": code,
                },
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()

    # ── User info ─────────────────────────────────────────────────

    async def get_authenticated_user(self) -> dict:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GITHUB_API}/user", headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def get_user_emails(self) -> list:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GITHUB_API}/user/emails", headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    # ── Repositories ──────────────────────────────────────────────

    async def get_user_repos(self, page: int = 1, per_page: int = 30) -> list:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GITHUB_API}/user/repos",
                headers=self.headers,
                params={
                    "sort": "updated",
                    "per_page": per_page,
                    "page": page,
                    "type": "owner",
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def get_repo(self, owner: str, repo: str) -> dict:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    # ── File tree & content ───────────────────────────────────────

    async def get_file_tree(self, owner: str, repo: str, branch: str = "main") -> List[dict]:
        """
        Fetches the recursive file tree. Returns a flat list of blobs
        (files only, no directories).
        """
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{branch}",
                headers=self.headers,
                params={"recursive": "1"},
            )
            resp.raise_for_status()
            tree = resp.json().get("tree", [])
            return [item for item in tree if item["type"] == "blob"]

    async def get_file_content(self, owner: str, repo: str, path: str) -> Optional[str]:
        """Downloads raw file content. Returns None if the file is binary or too large."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}",
                headers={**self.headers, "Accept": "application/vnd.github.raw+json"},
            )
            if resp.status_code != 200:
                return None
            # skip files larger than 500KB or binary
            if len(resp.content) > 500_000:
                return None
            try:
                return resp.text
            except UnicodeDecodeError:
                return None

    # ── Commits & contributors ────────────────────────────────────

    async def get_commits(
        self, owner: str, repo: str, per_page: int = 100, page: int = 1
    ) -> list:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/commits",
                headers=self.headers,
                params={"per_page": per_page, "page": page},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_contributors(self, owner: str, repo: str) -> list:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/contributors",
                headers=self.headers,
                params={"per_page": 30},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_languages(self, owner: str, repo: str) -> dict:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/languages",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    # ── Helpers ───────────────────────────────────────────────────

    @staticmethod
    def parse_repo_url(url: str) -> tuple[str, str]:
        """Extracts (owner, repo) from a GitHub URL."""
        parsed = urlparse(url)
        parts = parsed.path.strip("/").split("/")
        if len(parts) < 2:
            raise ValueError(f"Invalid GitHub repo URL: {url}")
        return parts[0], parts[1].replace(".git", "")


def _oauth_state_key(state: str) -> str:
    """Namespaced Redis key for an in-flight OAuth state token."""
    return f"oauth:gh:state:{state}"
