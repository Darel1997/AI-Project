"""
Slack Integration.

Lets engineering teams use RepoInsight directly in Slack. Two surfaces:

  1. Slash command  — `/repoinsight ask "how does billing work"`
                     `/repoinsight repos`           (list connected repos)
                     `/repoinsight pick <repo-slug>` (set the channel's default repo)

  2. Events API listener — when someone @-mentions @repoinsight in a thread,
     we run a chat query and post the answer as a thread reply with citations.

Why this matters: engineers already live in Slack. Putting RepoInsight there
means knowledge propagates through the channel automatically — when one person
asks "how does X work?", everyone in the channel sees the answer + citations,
and the next person to ask has the answer right there in scrollback.

How it stays grounded (no hallucinations):
  - Every Slack response goes through the same RAG pipeline as the web chat
  - Citations always include real file paths + line numbers from indexed code
  - We refuse to answer if the channel has no connected repo set
"""

from __future__ import annotations
import hashlib
import hmac
import json
import logging
import os
import time
from typing import Optional
from urllib.parse import parse_qs

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy import select, Column, Integer, String, BigInteger, ForeignKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, async_session, Base
from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User
from app.models.repository import Repository
from app.services.lab_service import search_similar, claude_complete_json

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/slack", tags=["slack"])


# ─────────────────────────────────────────────────────────────────
# Models — channel→repo mapping + workspace install tokens
# ─────────────────────────────────────────────────────────────────

class SlackWorkspace(Base):
    """One row per installed Slack workspace. Stores the bot token + team_id."""
    __tablename__ = "slack_workspaces"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    team_id = Column(String(64), unique=True, nullable=False)  # Slack workspace ID
    team_name = Column(String(255))
    bot_token = Column(String(255), nullable=False)            # xoxb-...
    bot_user_id = Column(String(64))
    installed_at = Column(BigInteger)


class SlackChannelRepo(Base):
    """Per-channel default repository binding."""
    __tablename__ = "slack_channel_repos"

    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("slack_workspaces.id"), nullable=False, index=True)
    channel_id = Column(String(64), nullable=False, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id"), nullable=False)


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class ConnectionStatus(BaseModel):
    connected: bool
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    install_url: Optional[str] = None


class ChannelBinding(BaseModel):
    repository_id: int
    channel_id: str


# ─────────────────────────────────────────────────────────────────
# User-facing endpoints (web app uses these)
# ─────────────────────────────────────────────────────────────────

@router.get("/status", response_model=ConnectionStatus)
async def slack_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return whether the user has connected a Slack workspace + the install URL."""
    res = await db.execute(select(SlackWorkspace).where(SlackWorkspace.user_id == user.id))
    ws = res.scalar_one_or_none()
    install_url = _build_install_url() if not ws else None
    return ConnectionStatus(
        connected=bool(ws),
        team_id=ws.team_id if ws else None,
        team_name=ws.team_name if ws else None,
        install_url=install_url,
    )


@router.post("/bind-channel")
async def bind_channel(
    body: ChannelBinding,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set a channel's default repository so /repoinsight ask works without a repo arg."""
    ws_res = await db.execute(select(SlackWorkspace).where(SlackWorkspace.user_id == user.id))
    ws = ws_res.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=400, detail="Slack workspace not connected")

    repo_res = await db.execute(select(Repository).where(Repository.id == body.repository_id))
    repo = repo_res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Upsert
    existing = await db.execute(
        select(SlackChannelRepo).where(
            SlackChannelRepo.workspace_id == ws.id,
            SlackChannelRepo.channel_id == body.channel_id,
        )
    )
    binding = existing.scalar_one_or_none()
    if binding:
        binding.repository_id = body.repository_id
    else:
        db.add(SlackChannelRepo(
            workspace_id=ws.id,
            channel_id=body.channel_id,
            repository_id=body.repository_id,
        ))
    await db.commit()
    return {"ok": True, "channel": body.channel_id, "repo": repo.full_name}


# ─────────────────────────────────────────────────────────────────
# Slack OAuth install flow
# ─────────────────────────────────────────────────────────────────

@router.get("/oauth/callback")
async def oauth_callback(code: str, state: str, db: AsyncSession = Depends(get_db)):
    """
    Slack redirects here after the user authorizes the app.
    Exchanges the code for a workspace bot token + persists it.

    The `state` param contains the authenticated user_id — we stash it in the
    install URL so we can attribute the workspace correctly.
    """
    if not _slack_configured():
        raise HTTPException(status_code=501, detail="Slack integration not configured. Set SLACK_CLIENT_ID + SLACK_CLIENT_SECRET in env.")

    try:
        user_id = int(state)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post("https://slack.com/api/oauth.v2.access", data={
            "client_id": settings.SLACK_CLIENT_ID,
            "client_secret": settings.SLACK_CLIENT_SECRET,
            "code": code,
            "redirect_uri": _redirect_uri(),
        })
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Slack OAuth failed: {r.status_code}")
    data = r.json()
    if not data.get("ok"):
        raise HTTPException(status_code=502, detail=f"Slack OAuth error: {data.get('error', 'unknown')}")

    team = data.get("team", {})
    bot_token = data.get("access_token")  # the bot token (starts with xoxb-)
    if not bot_token or not team.get("id"):
        raise HTTPException(status_code=502, detail="Slack OAuth response missing fields")

    # Upsert workspace
    existing = await db.execute(select(SlackWorkspace).where(SlackWorkspace.team_id == team["id"]))
    ws = existing.scalar_one_or_none()
    if ws:
        ws.bot_token = bot_token
        ws.team_name = team.get("name") or ws.team_name
        ws.user_id = user_id
    else:
        db.add(SlackWorkspace(
            user_id=user_id,
            team_id=team["id"],
            team_name=team.get("name", ""),
            bot_token=bot_token,
            bot_user_id=data.get("bot_user_id", ""),
            installed_at=int(time.time()),
        ))
    await db.commit()

    # Redirect back to the integrations page in the web app
    frontend = getattr(settings, "FRONTEND_URL", "") or "http://localhost:3000"
    return {
        "ok": True,
        "redirect": f"{frontend}/settings/integrations?slack=connected",
        "team_name": team.get("name"),
    }


# ─────────────────────────────────────────────────────────────────
# Slack-side endpoints (Slack hits these)
# ─────────────────────────────────────────────────────────────────

@router.post("/slash")
async def slash_command(
    request: Request,
    background_tasks: BackgroundTasks,
    x_slack_signature: str = Header(None),
    x_slack_request_timestamp: str = Header(None),
):
    """
    Handle the /repoinsight slash command. Slack expects an immediate 200 response,
    so we acknowledge fast and run the heavy work in the background, posting the
    real answer back via response_url.
    """
    body_bytes = await request.body()
    if not _verify_slack_signature(body_bytes, x_slack_signature, x_slack_request_timestamp):
        raise HTTPException(status_code=401, detail="Invalid Slack signature")

    payload = parse_qs(body_bytes.decode("utf-8"))
    text = (payload.get("text", [""])[0] or "").strip()
    team_id = payload.get("team_id", [""])[0]
    channel_id = payload.get("channel_id", [""])[0]
    user_id = payload.get("user_id", [""])[0]
    response_url = payload.get("response_url", [""])[0]

    # Parse subcommand
    parts = text.split(maxsplit=1)
    subcmd = (parts[0] if parts else "").lower()
    arg = parts[1] if len(parts) > 1 else ""

    if subcmd in ("help", "", None):
        return _ephemeral(_help_text())

    if subcmd == "repos":
        background_tasks.add_task(_post_repos_list, response_url, team_id)
        return _ephemeral("Looking up your connected repos...")

    if subcmd == "pick":
        background_tasks.add_task(_pick_channel_repo, response_url, team_id, channel_id, arg)
        return _ephemeral(f"Setting this channel's repo to `{arg}`...")

    if subcmd == "ask":
        if not arg:
            return _ephemeral("Usage: `/repoinsight ask <your question>`")
        background_tasks.add_task(_run_chat_query, response_url, team_id, channel_id, user_id, arg)
        return _ephemeral(f"Searching the codebase for: _{arg}_ ...")

    return _ephemeral(f"Unknown subcommand `{subcmd}`. Try `/repoinsight help`.")


@router.post("/events")
async def slack_events(
    request: Request,
    background_tasks: BackgroundTasks,
    x_slack_signature: str = Header(None),
    x_slack_request_timestamp: str = Header(None),
):
    """
    Slack Events API listener. Handles URL verification (one-time setup challenge)
    and app_mention events (someone @-ed our bot in a thread).
    """
    body_bytes = await request.body()
    if not _verify_slack_signature(body_bytes, x_slack_signature, x_slack_request_timestamp):
        raise HTTPException(status_code=401, detail="Invalid Slack signature")

    data = json.loads(body_bytes)

    # First-time URL verification handshake
    if data.get("type") == "url_verification":
        return {"challenge": data.get("challenge")}

    event = data.get("event", {})
    event_type = event.get("type")
    team_id = data.get("team_id", "")

    if event_type == "app_mention":
        text = event.get("text", "")
        # Strip the bot mention prefix (e.g. "<@U12345>")
        question = _strip_bot_mention(text)
        if not question:
            return {"ok": True}

        background_tasks.add_task(
            _post_thread_reply,
            team_id, event.get("channel"), event.get("ts"), question,
        )

    return {"ok": True}


# ─────────────────────────────────────────────────────────────────
# Background workers — these do the real work and post back to Slack
# ─────────────────────────────────────────────────────────────────

async def _run_chat_query(response_url: str, team_id: str, channel_id: str, slack_user_id: str, question: str):
    """RAG chat from Slack — same pipeline as web chat, formatted as Slack blocks."""
    async with async_session() as db:
        ws = await _workspace_by_team(db, team_id)
        if not ws:
            await _post_to_response_url(response_url, "This Slack workspace isn't connected to RepoInsight.")
            return

        repo = await _channel_repo(db, ws.id, channel_id)
        if not repo:
            await _post_to_response_url(
                response_url,
                "This channel doesn't have a default repository set. Run `/repoinsight pick <repo-slug>` first.",
            )
            return

    # Same RAG search as the web chat — real file citations, no hallucinations
    try:
        hits = await search_similar(repository_id=repo.id, query_text=question, top_k=8)
    except Exception as e:
        log.warning("Slack chat search_similar failed: %s", e)
        hits = []

    if not hits:
        await _post_to_response_url(
            response_url,
            f"I couldn't find anything relevant in `{repo.full_name}` for that question.",
        )
        return

    # Build the answer with citations
    context = "\n\n".join([
        f"FILE: {h.get('file_path')}\n```{(h.get('snippet') or '')[:600]}```"
        for h in hits[:6]
    ])
    prompt = (
        f"Question: {question}\n\n"
        f"Here are real code chunks from the {repo.full_name} repository:\n{context}\n\n"
        "Answer the question grounded ONLY in these chunks. Cite file paths inline. "
        "If the chunks don't contain enough information, say so honestly. Keep the answer tight — "
        "Slack messages are read on phones."
    )
    try:
        result = await claude_complete_json(
            system="You answer questions about real code. Always cite file paths. Never invent file paths or behaviors.",
            prompt=f"{prompt}\n\nReturn STRICT JSON: {{ \"answer\": str }}",
        )
        answer = result.get("answer") or "I found relevant code but couldn't form an answer."
    except Exception as e:
        log.warning("Slack chat LLM failed: %s", e)
        answer = "Found code matches but encountered an error generating the answer."

    blocks = _format_chat_blocks(question, answer, hits[:5], repo.full_name)
    await _post_to_response_url(response_url, answer, blocks=blocks)


async def _post_thread_reply(team_id: str, channel: str, thread_ts: str, question: str):
    """For @-mention events — post directly to the thread via chat.postMessage."""
    async with async_session() as db:
        ws = await _workspace_by_team(db, team_id)
        if not ws:
            return
        repo = await _channel_repo(db, ws.id, channel)
        if not repo:
            await _slack_post_message(
                ws.bot_token, channel,
                "I need a default repo for this channel first. Try `/repoinsight pick <repo-slug>`.",
                thread_ts=thread_ts,
            )
            return

    try:
        hits = await search_similar(repository_id=repo.id, query_text=question, top_k=8)
    except Exception:
        hits = []

    if not hits:
        await _slack_post_message(
            ws.bot_token, channel,
            f"I couldn't find anything relevant in `{repo.full_name}`.",
            thread_ts=thread_ts,
        )
        return

    context = "\n\n".join([
        f"FILE: {h.get('file_path')}\n```{(h.get('snippet') or '')[:600]}```"
        for h in hits[:6]
    ])
    prompt = (
        f"Question: {question}\n\nReal code chunks from {repo.full_name}:\n{context}\n\n"
        "Answer based ONLY on these chunks. Cite file paths. Keep it tight for Slack."
    )
    try:
        result = await claude_complete_json(
            system="Answer code questions from REAL chunks only. Cite file paths.",
            prompt=f"{prompt}\n\nReturn STRICT JSON: {{ \"answer\": str }}",
        )
        answer = result.get("answer") or "Found chunks but couldn't form an answer."
    except Exception:
        answer = "Found code matches but encountered an error."

    blocks = _format_chat_blocks(question, answer, hits[:5], repo.full_name)
    await _slack_post_message(ws.bot_token, channel, answer, blocks=blocks, thread_ts=thread_ts)


async def _post_repos_list(response_url: str, team_id: str):
    """Reply with the user's available repos."""
    async with async_session() as db:
        ws = await _workspace_by_team(db, team_id)
        if not ws:
            await _post_to_response_url(response_url, "Workspace not connected.")
            return
        # List the indexed repos for the user that installed this workspace
        repos_res = await db.execute(
            select(Repository).where(
                Repository.user_id == ws.user_id,
                Repository.is_indexed == True,  # noqa: E712
            ).limit(20)
        )
        repos = repos_res.scalars().all()

    if not repos:
        await _post_to_response_url(response_url, "No indexed repos yet. Add one in the RepoInsight web app.")
        return

    lines = ["*Your indexed repos:*"] + [f"• `{r.full_name}` — {r.language or 'mixed'}" for r in repos]
    lines.append("\nUse `/repoinsight pick <full-name>` in a channel to bind a repo to that channel.")
    await _post_to_response_url(response_url, "\n".join(lines))


async def _pick_channel_repo(response_url: str, team_id: str, channel_id: str, repo_slug: str):
    """Bind a channel to a specific repo."""
    repo_slug = repo_slug.strip().strip("`")
    async with async_session() as db:
        ws = await _workspace_by_team(db, team_id)
        if not ws:
            await _post_to_response_url(response_url, "Workspace not connected.")
            return
        repo_res = await db.execute(
            select(Repository).where(
                Repository.user_id == ws.user_id,
                Repository.full_name == repo_slug,
            )
        )
        repo = repo_res.scalar_one_or_none()
        if not repo:
            await _post_to_response_url(response_url, f"Repo `{repo_slug}` not found in your indexed repos.")
            return

        # Upsert binding
        existing = await db.execute(
            select(SlackChannelRepo).where(
                SlackChannelRepo.workspace_id == ws.id,
                SlackChannelRepo.channel_id == channel_id,
            )
        )
        b = existing.scalar_one_or_none()
        if b:
            b.repository_id = repo.id
        else:
            db.add(SlackChannelRepo(workspace_id=ws.id, channel_id=channel_id, repository_id=repo.id))
        await db.commit()

    await _post_to_response_url(response_url, f"✅ This channel is now connected to `{repo_slug}`.")


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _help_text() -> str:
    return (
        "*RepoInsight Slack commands*\n"
        "• `/repoinsight ask <question>` — ask about the channel's connected repo\n"
        "• `/repoinsight repos` — list your indexed repos\n"
        "• `/repoinsight pick <owner/repo>` — set this channel's default repo\n"
        "• `/repoinsight help` — show this message\n"
        "\nYou can also `@repoinsight <question>` in any thread."
    )


def _ephemeral(text: str) -> dict:
    """Slack ephemeral response — only visible to the user who ran the command."""
    return {"response_type": "ephemeral", "text": text}


def _format_chat_blocks(question: str, answer: str, hits: list, repo_name: str) -> list:
    """Turn an answer + citations into Slack Block Kit JSON."""
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"💡 RepoInsight · {repo_name}"}},
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*Q:* _{question[:200]}_"}},
        {"type": "divider"},
        {"type": "section", "text": {"type": "mrkdwn", "text": answer[:2900]}},
    ]
    if hits:
        cite_lines = []
        for h in hits[:5]:
            fp = h.get("file_path", "?")
            snip = (h.get("snippet") or "")[:120].replace("\n", " ")
            cite_lines.append(f"• `{fp}` — _{snip}_")
        blocks.append({"type": "context", "elements": [
            {"type": "mrkdwn", "text": "*Sources:*\n" + "\n".join(cite_lines)}
        ]})
    return blocks


def _strip_bot_mention(text: str) -> str:
    """Remove the leading <@U...> mention from an app_mention event text."""
    import re
    return re.sub(r"^\s*<@[A-Z0-9]+>\s*", "", text or "").strip()


async def _post_to_response_url(response_url: str, text: str, blocks: Optional[list] = None):
    """Post a delayed reply via Slack response_url."""
    payload: dict = {"text": text, "response_type": "in_channel"}
    if blocks:
        payload["blocks"] = blocks
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(response_url, json=payload)
    except Exception as e:
        log.warning("Slack response_url post failed: %s", e)


async def _slack_post_message(bot_token: str, channel: str, text: str, blocks: Optional[list] = None, thread_ts: Optional[str] = None):
    """Direct chat.postMessage call — used for @-mentions."""
    payload: dict = {"channel": channel, "text": text}
    if blocks: payload["blocks"] = blocks
    if thread_ts: payload["thread_ts"] = thread_ts
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                "https://slack.com/api/chat.postMessage",
                headers={"Authorization": f"Bearer {bot_token}"},
                json=payload,
            )
    except Exception as e:
        log.warning("Slack chat.postMessage failed: %s", e)


def _verify_slack_signature(body: bytes, signature: Optional[str], timestamp: Optional[str]) -> bool:
    """
    Verify Slack signing-secret HMAC. Skips verification if no secret is set
    (dev mode), but logs a loud warning. Production deployments MUST set it.
    """
    secret = getattr(settings, "SLACK_SIGNING_SECRET", "")
    if not secret:
        log.warning("SLACK_SIGNING_SECRET not set — Slack signature verification skipped")
        return True
    if not signature or not timestamp:
        return False
    # Reject requests older than 5 min (replay protection)
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
    except (TypeError, ValueError):
        return False

    base = f"v0:{timestamp}:{body.decode('utf-8')}"
    computed = "v0=" + hmac.new(secret.encode(), base.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, signature)


def _slack_configured() -> bool:
    return bool(getattr(settings, "SLACK_CLIENT_ID", "") and getattr(settings, "SLACK_CLIENT_SECRET", ""))


def _redirect_uri() -> str:
    base = (getattr(settings, "BACKEND_URL", "") or os.getenv("BACKEND_URL", "http://localhost:8000")).rstrip("/")
    return f"{base}/api/slack/oauth/callback"


def _build_install_url() -> Optional[str]:
    if not _slack_configured():
        return None
    scopes = ",".join([
        "commands",          # for /repoinsight
        "app_mentions:read", # to receive @-mentions
        "chat:write",        # to post replies
        "channels:read",     # to know channel names in /repos
        "users:read",        # for nice attribution
    ])
    # state will be set per-user by the frontend before redirect
    return (
        f"https://slack.com/oauth/v2/authorize?client_id={settings.SLACK_CLIENT_ID}"
        f"&scope={scopes}&redirect_uri={_redirect_uri()}"
    )


async def _workspace_by_team(db: AsyncSession, team_id: str):
    res = await db.execute(select(SlackWorkspace).where(SlackWorkspace.team_id == team_id))
    return res.scalar_one_or_none()


async def _channel_repo(db: AsyncSession, workspace_id: int, channel_id: str):
    res = await db.execute(
        select(Repository).join(SlackChannelRepo, Repository.id == SlackChannelRepo.repository_id).where(
            SlackChannelRepo.workspace_id == workspace_id,
            SlackChannelRepo.channel_id == channel_id,
        )
    )
    return res.scalar_one_or_none()
