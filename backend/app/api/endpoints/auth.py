"""
Authentication endpoints.

Supports two auth flows:
1. Email + password (register → login → JWT)
2. GitHub OAuth (redirect → callback → JWT)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)
from app.models.user import User
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    UserResponse,
    GitHubCallbackRequest,
)
from app.services.github_service import GitHubService

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # check if email already taken
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/github/url")
async def github_oauth_url():
    """Returns the GitHub OAuth authorization URL for the frontend to redirect to."""
    return {"url": GitHubService.get_oauth_url()}


@router.post("/github/callback", response_model=TokenResponse)
async def github_callback(body: GitHubCallbackRequest, db: AsyncSession = Depends(get_db)):
    """Handles the GitHub OAuth callback — exchanges code for token, creates/updates user."""

    # exchange the code for a GitHub access token
    token_data = await GitHubService.exchange_code_for_token(body.code)
    gh_token = token_data.get("access_token")
    if not gh_token:
        raise HTTPException(status_code=400, detail="Failed to get GitHub token")

    # fetch the GitHub user profile
    gh = GitHubService(access_token=gh_token)
    gh_user = await gh.get_authenticated_user()
    gh_emails = await gh.get_user_emails()

    # find a verified primary email
    primary_email = next(
        (e["email"] for e in gh_emails if e.get("primary") and e.get("verified")),
        gh_user.get("email"),
    )
    if not primary_email:
        raise HTTPException(status_code=400, detail="No verified email on GitHub account")

    # find or create the user
    result = await db.execute(select(User).where(User.github_id == gh_user["id"]))
    user = result.scalar_one_or_none()

    if user:
        # update token on re-auth
        user.github_access_token = gh_token
        user.avatar_url = gh_user.get("avatar_url")
    else:
        # check if email already exists (link accounts)
        result = await db.execute(select(User).where(User.email == primary_email))
        user = result.scalar_one_or_none()

        if user:
            user.github_id = gh_user["id"]
            user.github_username = gh_user["login"]
            user.github_access_token = gh_token
            user.avatar_url = gh_user.get("avatar_url")
        else:
            user = User(
                email=primary_email,
                full_name=gh_user.get("name"),
                avatar_url=gh_user.get("avatar_url"),
                github_id=gh_user["id"],
                github_username=gh_user["login"],
                github_access_token=gh_token,
            )
            db.add(user)

    await db.flush()
    await db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)
