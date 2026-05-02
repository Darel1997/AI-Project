"""Request and response schemas for authentication endpoints."""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, description="Minimum 8 characters")
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
    code: str


# resolve forward reference
TokenResponse.model_rebuild()
