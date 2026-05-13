"""
Authentication endpoints.

Supports two auth flows:
1. Email + password (register → login → JWT)
2. GitHub OAuth (redirect → callback → JWT)
"""

import re
import secrets
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.core.config import settings
from app.core.crypto import encrypt_token
from app.core.rate_limit import rate_limit
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)
from app.models.user import User
from app.models.organization import Organization, Membership, OrgRole
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    UserResponse,
    GitHubCallbackRequest,
    DeleteAccountRequest,
    ChangePasswordRequest,
)
from app.services.github_service import GitHubService

router = APIRouter()


async def _ensure_personal_org(db: AsyncSession, user: User) -> None:
    """
    Auto-create the personal Organization + owner Membership for a new user.
    Called after a successful registration (email or GitHub).
    Idempotent — safe to call for existing users.
    """
    existing = await db.execute(
        select(Membership)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(
            Membership.user_id == user.id,
            Organization.is_personal.is_(True),
        )
    )
    if existing.scalar_one_or_none():
        return

    base_slug = re.sub(r"[^a-z0-9-]+", "-", (user.full_name or user.email.split("@")[0]).lower()).strip("-") or "personal"
    # Ensure unique slug
    slug = base_slug
    for _ in range(5):
        check = await db.execute(select(Organization).where(Organization.slug == slug))
        if not check.scalar_one_or_none():
            break
        slug = f"{base_slug}-{secrets.token_hex(3)}"

    org = Organization(
        name=f"{user.full_name or user.email.split('@')[0]}'s workspace",
        slug=slug,
        is_personal=True,
        plan="free",
        seats=1,
    )
    db.add(org)
    await db.flush()

    membership = Membership(
        user_id=user.id,
        organization_id=org.id,
        role=OrgRole.owner,
    )
    db.add(membership)


@router.post("/register", dependencies=[Depends(rate_limit("auth", limit=10, window=60))], response_model=TokenResponse, status_code=201)
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

    # Every new user gets a personal organization
    await _ensure_personal_org(db, user)
    await db.commit()

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", dependencies=[Depends(rate_limit("auth", limit=10, window=60))], response_model=TokenResponse)
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
    """Returns the GitHub OAuth authorization URL for the frontend to redirect to.

    The response also includes the CSRF state token that the frontend should
    hold onto and submit back to /github/callback. The frontend doesn't need
    to do anything with it beyond passing it through — the URL already
    embeds it, and the backend verifies the state on callback.
    """
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
        raise HTTPException(
            status_code=501,
            detail=(
                "GitHub OAuth is not configured on this server. "
                "An administrator must set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET "
                "environment variables. See https://docs.github.com/en/apps/oauth-apps/"
                "building-oauth-apps/creating-an-oauth-app for setup instructions."
            ),
        )
    url, _state = await GitHubService.get_oauth_url()
    return {"url": url}


@router.get("/github/status")
async def github_oauth_status():
    """
    Check whether GitHub OAuth is configured on this server without exposing secrets.
    Used by the frontend to decide whether to show the "Continue with GitHub" button.
    """
    return {
        "configured": bool(settings.GITHUB_CLIENT_ID and settings.GITHUB_CLIENT_SECRET),
    }


@router.post("/github/callback", response_model=TokenResponse)
async def github_callback(body: GitHubCallbackRequest, db: AsyncSession = Depends(get_db)):
    """Handles the GitHub OAuth callback — exchanges code for token, creates/updates user."""

    # Verify CSRF state. Single-use — `consume_oauth_state` deletes the key
    # so the same callback URL can't pass twice. We allow the legacy path
    # (no state) during rollout, but log loudly so the gap can be closed
    # once every deployed frontend builds the state into its flow.
    if body.state:
        if not await GitHubService.consume_oauth_state(body.state):
            raise HTTPException(
                status_code=400,
                detail="OAuth state is invalid or expired. Please start the sign-in flow again.",
            )
    else:
        # Belt-and-suspenders: once the frontend reliably passes state,
        # make state required by deleting this branch and changing the
        # schema's Optional[str] to a required field.
        import logging
        logging.getLogger("repoinsight.auth").warning(
            "GitHub callback received without state token — CSRF protection skipped. "
            "Update the frontend to forward the state from /github/url."
        )

    # exchange the code for a GitHub access token
    token_data = await GitHubService.exchange_code_for_token(body.code)
    gh_token = token_data.get("access_token")
    if not gh_token:
        raise HTTPException(status_code=400, detail="Failed to get GitHub token")

    # fetch the GitHub user profile (using the plaintext token in-memory only —
    # we encrypt before storing)
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

    # Encrypt the token before it touches the DB. encrypt_token handles
    # None/empty gracefully but we just confirmed gh_token is truthy above.
    enc_token = encrypt_token(gh_token)

    # find or create the user
    result = await db.execute(select(User).where(User.github_id == gh_user["id"]))
    user = result.scalar_one_or_none()

    if user:
        # update token on re-auth
        user.github_access_token = enc_token
        user.avatar_url = gh_user.get("avatar_url")
    else:
        # check if email already exists (link accounts)
        result = await db.execute(select(User).where(User.email == primary_email))
        user = result.scalar_one_or_none()

        if user:
            user.github_id = gh_user["id"]
            user.github_username = gh_user["login"]
            user.github_access_token = enc_token
            user.avatar_url = gh_user.get("avatar_url")
        else:
            user = User(
                email=primary_email,
                full_name=gh_user.get("name"),
                avatar_url=gh_user.get("avatar_url"),
                github_id=gh_user["id"],
                github_username=gh_user["login"],
                github_access_token=enc_token,
            )
            db.add(user)

    await db.flush()

    # Ensure the user has a personal organization (idempotent for existing users)
    await _ensure_personal_org(db, user)
    await db.commit()

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse.model_validate(user)


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None


@router.patch("/me", response_model=UserResponse)
async def update_profile(
    body: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's profile (display name)."""
    if body.full_name is not None:
        user.full_name = body.full_name.strip() or None
    await db.flush()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.post(
    "/change-password",
    dependencies=[Depends(rate_limit("auth", limit=5, window=300))],
)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the current user's password."""
    if not user.hashed_password:
        raise HTTPException(
            status_code=400,
            detail="This account signed up with GitHub OAuth and has no password to change.",
        )
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(body.new_password)
    await db.flush()
    await db.commit()
    return {"message": "Password updated"}


@router.delete(
    "/me",
    status_code=204,
    # Aggressive rate limit on this one — a leaked JWT shouldn't be able to
    # destroy an account in seconds. 3 attempts per hour gives a legitimate
    # user enough room to retry a mistake, far less than what a brute-force
    # bot would need.
    dependencies=[Depends(rate_limit("auth", limit=3, window=3600))],
)
async def delete_account(
    body: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Permanently delete the current user's account and all their data.

    Defense in depth:
      - Bearer token (the JWT) is the first gate.
      - `confirm_text` must equal the user's email — matches the existing
        frontend UI which already requires this typed match.
      - For password-holding accounts, the current password is required.
        Stops a one-shot JWT theft from wiping the account.
      - Rate limit: 3 attempts per hour per identity (set above).
    """
    if body.confirm_text.strip().lower() != user.email.strip().lower():
        raise HTTPException(
            status_code=400,
            detail="Confirmation text does not match your account email.",
        )
    if user.hashed_password:
        if not body.password:
            raise HTTPException(
                status_code=400,
                detail="Password is required to delete a password-protected account.",
            )
        if not verify_password(body.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Password is incorrect.")
    # OAuth-only users (no hashed_password) get to skip the password check —
    # the JWT + email-typed confirmation is their highest available factor.

    await db.delete(user)
    await db.commit()
