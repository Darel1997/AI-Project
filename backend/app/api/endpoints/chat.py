"""
Chat endpoints — RAG-powered conversation with a codebase.

Each message is stored in the database for history, and the
AI service retrieves relevant code chunks from ChromaDB to
ground its answers.
"""

import asyncio
import functools

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.redis import check_rate_limit
from app.models.user import User
from app.models.repository import Repository
from app.models.chat import ChatMessage
from app.schemas.chat import ChatRequest, ChatResponse, ChatHistoryItem, ChatSource
from app.services.ai_service import AIService

router = APIRouter()


# Max history rows the server will ever return in one request. Hard cap to
# stop a misbehaving client from requesting tens of thousands of rows.
MAX_HISTORY_LIMIT = 200


@router.post("/send", response_model=ChatResponse)
async def send_message(
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a message to chat with a repository's codebase."""

    # rate limit: 30 chat messages per minute per user
    allowed = await check_rate_limit(f"chat:{user.id}", limit=30, window=60)
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")

    # verify the repo exists and belongs to the user
    result = await db.execute(
        select(Repository).where(
            Repository.id == body.repository_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    if not repo.is_indexed:
        raise HTTPException(
            status_code=400,
            detail="Repository is still being indexed. Please wait.",
        )

    # load recent conversation history for multi-turn context
    history_result = await db.execute(
        select(ChatMessage)
        .where(
            ChatMessage.user_id == user.id,
            ChatMessage.repository_id == body.repository_id,
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history_msgs = list(reversed(history_result.scalars().all()))
    history = [{"role": m.role, "content": m.content} for m in history_msgs]

    # Call the AI service with RAG. The sync method involves a blocking HTTP
    # call to Anthropic — run it in the default thread pool so it doesn't
    # pin the FastAPI event loop while a single chat is in flight.
    ai = AIService()
    result = await asyncio.get_running_loop().run_in_executor(
        None,
        functools.partial(ai.chat_with_repo, repo.id, body.message, history),
    )

    # save user message
    user_msg = ChatMessage(
        user_id=user.id,
        repository_id=body.repository_id,
        role="user",
        content=body.message,
    )
    db.add(user_msg)

    # save assistant response
    assistant_msg = ChatMessage(
        user_id=user.id,
        repository_id=body.repository_id,
        role="assistant",
        content=result["answer"],
        sources=[s for s in result["sources"]],
    )
    db.add(assistant_msg)
    await db.flush()
    await db.refresh(assistant_msg)

    return ChatResponse(
        answer=result["answer"],
        sources=[ChatSource(**s) for s in result["sources"]],
        message_id=assistant_msg.id,
    )


class ChatHistoryPage(BaseModel):
    """Paginated chat history response."""
    messages: list[ChatHistoryItem]
    has_more: bool
    # The smallest id returned in this page. Pass this back as `before_id`
    # to fetch the next-older page. Null when there are no more.
    next_cursor: int | None


@router.get("/history/{repo_id}", response_model=ChatHistoryPage)
async def get_chat_history(
    repo_id: int,
    before_id: int | None = Query(
        None,
        description="Return messages with id < before_id. Use the next_cursor from the previous response.",
    ),
    limit: int = Query(50, ge=1, le=MAX_HISTORY_LIMIT),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the most recent chat messages for a repo, newest-first internally
    but returned in chronological order (oldest first) so the frontend can
    append them to the bottom of its list.

    Long conversations used to return the entire history on every load.
    Now we paginate: latest 50 by default, request more with `before_id`.
    """
    # Verify the user owns this repo before exposing any history
    repo_check = await db.execute(
        select(Repository.id).where(
            Repository.id == repo_id,
            Repository.user_id == user.id,
        )
    )
    if not repo_check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Repository not found")

    query = (
        select(ChatMessage)
        .where(
            ChatMessage.user_id == user.id,
            ChatMessage.repository_id == repo_id,
        )
        .order_by(ChatMessage.id.desc())
        .limit(limit + 1)  # fetch one extra to know if there's more
    )
    if before_id is not None:
        query = query.where(ChatMessage.id < before_id)

    result = await db.execute(query)
    rows = result.scalars().all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    # Chronological order for the client.
    rows = list(reversed(rows))

    next_cursor = rows[0].id if rows and has_more else None
    return ChatHistoryPage(
        messages=[ChatHistoryItem.model_validate(r) for r in rows],
        has_more=has_more,
        next_cursor=next_cursor,
    )
