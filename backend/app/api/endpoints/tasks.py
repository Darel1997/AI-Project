"""
Task generation endpoints — AI-powered Jira-style ticket creation.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.repository import Repository, RepoFile
from app.models.chat import Task
from app.schemas.chat import GenerateTasksRequest, TaskResponse
from app.services.ai_service import AIService

router = APIRouter()


@router.post("/generate", response_model=list[TaskResponse])
async def generate_tasks(
    body: GenerateTasksRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generates Jira-style engineering tasks from codebase analysis."""
    result = await db.execute(
        select(Repository).where(
            Repository.id == body.repository_id,
            Repository.user_id == user.id,
        )
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # sample files
    files_result = await db.execute(
        select(RepoFile)
        .where(
            RepoFile.repository_id == body.repository_id,
            RepoFile.content.isnot(None),
        )
        .order_by(RepoFile.line_count.desc())
        .limit(12)
    )
    files = files_result.scalars().all()
    sample_files = [{"path": f.path, "content": f.content} for f in files]

    ai = AIService()
    task_data = ai.generate_tasks(
        repo.id, sample_files,
        focus_area=body.focus_area,
        count=body.count,
    )

    # persist tasks to the database
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
    tasks = result.scalars().all()
    return [TaskResponse.model_validate(t) for t in tasks]
