"""Request and response schemas for authentication endpoints."""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


# Stronger password policy than the previous 8-char minimum:
#   - 12 chars minimum (NIST 800-63B current guidance favors length over complexity)
#   - 128 chars maximum (defense against DoS via giant inputs hitting bcrypt;
#     bcrypt has a hard 72-byte limit anyway, but we reject early)
PASSWORD_MIN = 12
PASSWORD_MAX = 128


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(
        ...,
        min_length=PASSWORD_MIN,
        max_length=PASSWORD_MAX,
        description=f"Between {PASSWORD_MIN} and {PASSWORD_MAX} characters.",
    )
    full_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    github_username: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class GitHubCallbackRequest(BaseModel):
    """
    Callback from GitHub's OAuth redirect.

    `state` is the CSRF token we issued in /github/url. It must match a
    state value still in Redis or the callback is rejected.
    """
    code: str
    # Optional during the rollout window — old frontend builds may not send it.
    # Once you're confident every deployed frontend includes state, change this
    # to `state: str = Field(..., min_length=1)` to make it required.
    state: Optional[str] = None


class DeleteAccountRequest(BaseModel):
    """
    Confirmation payload for account deletion.

    `confirm_text` must equal the user's own email — same UI the frontend
    already requires (settings page makes the user type their email).
    `password` is required for accounts with a password set; OAuth-only
    accounts (no password) may omit it.
    """
    confirm_text: str
    password: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(
        ...,
        min_length=PASSWORD_MIN,
        max_length=PASSWORD_MAX,
    )


# resolve forward reference
TokenResponse.model_rebuild()
