"""
Task endpoints — AI-generated Jira-style tickets with full CRUD.

Supports: generate, list, update status, delete individual, delete all.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.rate_limit import rate_limit
from app.services.feature_gate import require_feature
from app.models.user import User
from app.models.repository import Repository, RepoFile
from app.models.chat import Task
from app.schemas.chat import GenerateTasksRequest, TaskResponse
from app.services.ai_service import AIService, AIRequestTimeout

router = APIRouter()


class UpdateTaskRequest(BaseModel):
    status: Optional[str] = None        # open | in_progress | done
    priority: Optional[str] = None      # critical | high | medium | low
    title: Optional[str] = None
    description: Optional[str] = None


@router.post("/generate", dependencies=[Depends(require_feature("task_generator")), Depends(rate_limit("ai", limit=20, window=60))], response_model=list[TaskResponse])
async def generate_tasks(
    body: GenerateTasksRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Repository).where(
            Repository.id == body.repository_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    files_result = await db.execute(
        select(RepoFile)
        .where(RepoFile.repository_id == body.repository_id, RepoFile.content.isnot(None))
        .order_by(RepoFile.line_count.desc())
        .limit(12)
    )
    files = files_result.scalars().all()
    sample_files = [{"path": f.path, "content": f.content} for f in files]

    ai = AIService()
    try:
        task_data = await ai.a_generate_tasks(
            repo.id, sample_files, focus_area=body.focus_area, count=body.count,
        )
    except AIRequestTimeout as e:
        raise HTTPException(status_code=504, detail=str(e))

    created = []
    for t in task_data:
        task = Task(
            user_id=user.id,
            repository_id=body.repository_id,
            title=t.get("title", "Untitled Task"),
            description=t.get("description", ""),
            priority=t.get("priority", "medium"),
            difficulty=t.get("difficulty", "medium"),
            task_type=t.get("task_type", "feature"),
            suggested_files=t.get("suggested_files", []),
        )
        db.add(task)
        await db.flush()
        await db.refresh(task)
        created.append(TaskResponse.model_validate(task))

    return created


@router.get("/{repo_id}", response_model=list[TaskResponse])
async def list_tasks(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task)
        .where(Task.user_id == user.id, Task.repository_id == repo_id)
        .order_by(Task.created_at.desc())
    )
    return [TaskResponse.model_validate(t) for t in result.scalars().all()]


@router.patch("/update/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: int,
    body: UpdateTaskRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a task's status, priority, title, or description."""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if body.status is not None:
        if body.status not in ("open", "in_progress", "done"):
            raise HTTPException(status_code=400, detail="Invalid status")
        task.status = body.status
    if body.priority is not None:
        task.priority = body.priority
    if body.title is not None:
        task.title = body.title
    if body.description is not None:
        task.description = body.description

    await db.flush()
    await db.refresh(task)
    return TaskResponse.model_validate(task)


@router.delete("/delete/{task_id}", status_code=204)
async def delete_task(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single task."""
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)


@router.delete("/clear/{repo_id}", status_code=204)
async def clear_all_tasks(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete all tasks for a repository."""
    await db.execute(
        sql_delete(Task).where(Task.user_id == user.id, Task.repository_id == repo_id)
    )
