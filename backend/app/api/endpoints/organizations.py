"""
Organization endpoints — multi-tenant workspaces with role-based access.

Endpoints:
  GET    /api/orgs/                    — list orgs the user is a member of
  POST   /api/orgs/                    — create a new org (user becomes owner)
  GET    /api/orgs/{id}                — org details + member list
  PATCH  /api/orgs/{id}                — update name/description (admin+)
  DELETE /api/orgs/{id}                — delete org (owner only, not personal)

  POST   /api/orgs/{id}/invitations    — invite by email (admin+)
  GET    /api/orgs/{id}/invitations    — list pending invitations (admin+)
  DELETE /api/orgs/{id}/invitations/{inv_id}  — revoke invitation (admin+)
  POST   /api/orgs/invitations/{token}/accept  — accept invitation
  POST   /api/orgs/invitations/{token}/decline — decline invitation

  PATCH  /api/orgs/{id}/members/{user_id}/role — change role (admin+, can't demote owner)
  DELETE /api/orgs/{id}/members/{user_id}      — remove member (admin+ or self)
"""

import secrets
import re
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.organization import Organization, Membership, Invitation, OrgRole

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────
#  Schemas
# ─────────────────────────────────────────────────────────────────────

class OrgCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    slug: Optional[str] = None
    description: Optional[str] = None


class OrgUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    description: Optional[str] = None


class OrgSummary(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str]
    avatar_url: Optional[str]
    is_personal: bool
    plan: str
    seats: int
    member_count: int
    my_role: str

    class Config:
        from_attributes = True


class MemberOut(BaseModel):
    user_id: int
    email: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    role: str
    joined_at: datetime


class OrgDetailResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str]
    avatar_url: Optional[str]
    is_personal: bool
    plan: str
    seats: int
    my_role: str
    members: List[MemberOut]


class InvitationRequest(BaseModel):
    email: EmailStr
    role: OrgRole = OrgRole.member


class InvitationOut(BaseModel):
    id: int
    email: str
    role: str
    expires_at: datetime
    created_at: datetime


class RoleChangeRequest(BaseModel):
    role: OrgRole


# ─────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Create a URL-safe slug from a name."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9-]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:50] or "org"


async def _ensure_membership(
    db: AsyncSession, user_id: int, org_id: int, min_role: OrgRole = OrgRole.member
) -> Membership:
    """
    Fetch the user's membership in the org, enforce role-at-least gate.
    Raises 403 / 404 appropriately.

    Role precedence (higher = more permissive):
      owner > admin > member
    """
    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.organization_id == org_id,
        )
    )
    m = result.scalar_one_or_none()
    if not m:
        # Return 404 not 403 so we don't leak that this org even exists
        raise HTTPException(status_code=404, detail="Organization not found")

    rank = {OrgRole.member: 1, OrgRole.admin: 2, OrgRole.owner: 3}
    if rank[m.role] < rank[min_role]:
        raise HTTPException(
            status_code=403,
            detail=f"Requires role {min_role.value} or higher (you are {m.role.value})",
        )
    return m


async def _load_members(db: AsyncSession, org_id: int) -> List[MemberOut]:
    """Full member list with joined user info."""
    result = await db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == org_id)
        .order_by(Membership.created_at.asc())
    )
    out: List[MemberOut] = []
    for m, u in result.all():
        out.append(MemberOut(
            user_id=u.id,
            email=u.email,
            full_name=u.full_name,
            avatar_url=u.avatar_url,
            role=m.role.value,
            joined_at=m.created_at,
        ))
    return out


async def _org_summary(db: AsyncSession, org: Organization, my_role: OrgRole) -> OrgSummary:
    """Build the OrgSummary for the current user's view of the org."""
    count_result = await db.execute(
        select(Membership).where(Membership.organization_id == org.id)
    )
    member_count = len(count_result.scalars().all())
    return OrgSummary(
        id=org.id,
        name=org.name,
        slug=org.slug,
        description=org.description,
        avatar_url=org.avatar_url,
        is_personal=org.is_personal,
        plan=org.plan,
        seats=org.seats,
        member_count=member_count,
        my_role=my_role.value,
    )


# ─────────────────────────────────────────────────────────────────────
#  CRUD
# ─────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[OrgSummary])
async def list_orgs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every org the user is a member of, personal org first."""
    result = await db.execute(
        select(Organization, Membership)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.is_personal.desc(), Organization.created_at.asc())
    )
    rows = result.all()
    return [await _org_summary(db, org, m.role) for org, m in rows]


@router.post("/", response_model=OrgSummary, status_code=201)
async def create_org(
    payload: OrgCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new (non-personal) org. User becomes owner."""
    slug = payload.slug or _slugify(payload.name)

    # Handle slug collisions by appending random suffix
    existing = await db.execute(select(Organization).where(Organization.slug == slug))
    if existing.scalar_one_or_none():
        slug = f"{slug}-{secrets.token_hex(3)}"

    org = Organization(
        name=payload.name,
        slug=slug,
        description=payload.description,
        is_personal=False,
        plan="free",
        seats=1,
    )
    db.add(org)
    await db.flush()  # get org.id

    membership = Membership(
        user_id=user.id,
        organization_id=org.id,
        role=OrgRole.owner,
    )
    db.add(membership)
    await db.commit()
    await db.refresh(org)

    return await _org_summary(db, org, OrgRole.owner)


@router.get("/{org_id}", response_model=OrgDetailResponse)
async def get_org(
    org_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    membership = await _ensure_membership(db, user.id, org_id)
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    members = await _load_members(db, org_id)
    return OrgDetailResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        description=org.description,
        avatar_url=org.avatar_url,
        is_personal=org.is_personal,
        plan=org.plan,
        seats=org.seats,
        my_role=membership.role.value,
        members=members,
    )


@router.patch("/{org_id}", response_model=OrgSummary)
async def update_org(
    org_id: int,
    payload: OrgUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    m = await _ensure_membership(db, user.id, org_id, OrgRole.admin)
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if org.is_personal:
        raise HTTPException(status_code=400, detail="Cannot update personal organization")

    if payload.name is not None:
        org.name = payload.name
    if payload.description is not None:
        org.description = payload.description
    await db.commit()
    await db.refresh(org)

    return await _org_summary(db, org, m.role)


@router.delete("/{org_id}", status_code=204)
async def delete_org(
    org_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_membership(db, user.id, org_id, OrgRole.owner)
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if org.is_personal:
        raise HTTPException(status_code=400, detail="Cannot delete personal organization")

    await db.delete(org)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────
#  Members
# ─────────────────────────────────────────────────────────────────────

@router.patch("/{org_id}/members/{member_user_id}/role", response_model=MemberOut)
async def change_member_role(
    org_id: int,
    member_user_id: int,
    payload: RoleChangeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    actor = await _ensure_membership(db, user.id, org_id, OrgRole.admin)

    # Fetch target
    result = await db.execute(
        select(Membership).where(
            Membership.organization_id == org_id,
            Membership.user_id == member_user_id,
        )
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")

    # Only owners can promote or demote other owners
    if target.role == OrgRole.owner and actor.role != OrgRole.owner:
        raise HTTPException(status_code=403, detail="Only owners can change owner roles")
    if payload.role == OrgRole.owner and actor.role != OrgRole.owner:
        raise HTTPException(status_code=403, detail="Only owners can promote to owner")

    target.role = payload.role
    await db.commit()

    # Return updated member
    user_result = await db.execute(select(User).where(User.id == member_user_id))
    u = user_result.scalar_one()
    return MemberOut(
        user_id=u.id,
        email=u.email,
        full_name=u.full_name,
        avatar_url=u.avatar_url,
        role=target.role.value,
        joined_at=target.created_at,
    )


@router.delete("/{org_id}/members/{member_user_id}", status_code=204)
async def remove_member(
    org_id: int,
    member_user_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a member. Users can remove themselves. Admins can remove anyone except owners (owners can remove owners, except last one)."""
    is_self = user.id == member_user_id
    required_role = OrgRole.member if is_self else OrgRole.admin
    actor = await _ensure_membership(db, user.id, org_id, required_role)

    result = await db.execute(
        select(Membership).where(
            Membership.organization_id == org_id,
            Membership.user_id == member_user_id,
        )
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")

    # Can't remove an owner unless you're also an owner
    if target.role == OrgRole.owner and actor.role != OrgRole.owner:
        raise HTTPException(status_code=403, detail="Only owners can remove other owners")

    # If removing the last owner, block
    if target.role == OrgRole.owner:
        owners = await db.execute(
            select(Membership).where(
                Membership.organization_id == org_id,
                Membership.role == OrgRole.owner,
            )
        )
        if len(owners.scalars().all()) <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last owner; transfer ownership first")

    await db.delete(target)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────
#  Invitations
# ─────────────────────────────────────────────────────────────────────

@router.post("/{org_id}/invitations", response_model=InvitationOut, status_code=201)
async def invite_member(
    org_id: int,
    payload: InvitationRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_membership(db, user.id, org_id, OrgRole.admin)

    # Check if user already a member
    existing_user = await db.execute(select(User).where(User.email == payload.email))
    existing_user = existing_user.scalar_one_or_none()
    if existing_user:
        existing_membership = await db.execute(
            select(Membership).where(
                Membership.user_id == existing_user.id,
                Membership.organization_id == org_id,
            )
        )
        if existing_membership.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="User is already a member")

    # Check for existing pending invitation
    existing_inv = await db.execute(
        select(Invitation).where(
            Invitation.organization_id == org_id,
            Invitation.email == payload.email,
        )
    )
    existing_inv = existing_inv.scalar_one_or_none()
    if existing_inv:
        # Refresh expiry rather than erroring — user probably lost the first email
        existing_inv.token = secrets.token_urlsafe(32)
        existing_inv.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        existing_inv.role = payload.role
        existing_inv.invited_by_id = user.id
        await db.commit()
        await db.refresh(existing_inv)
        return InvitationOut(
            id=existing_inv.id,
            email=existing_inv.email,
            role=existing_inv.role.value,
            expires_at=existing_inv.expires_at,
            created_at=existing_inv.created_at,
        )

    invitation = Invitation(
        organization_id=org_id,
        email=payload.email,
        role=payload.role,
        invited_by_id=user.id,
        token=secrets.token_urlsafe(32),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    # TODO: send email with accept link using invitation.token
    return InvitationOut(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role.value,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
    )


@router.get("/{org_id}/invitations", response_model=List[InvitationOut])
async def list_invitations(
    org_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_membership(db, user.id, org_id, OrgRole.admin)
    result = await db.execute(
        select(Invitation)
        .where(Invitation.organization_id == org_id)
        .order_by(Invitation.created_at.desc())
    )
    invs = result.scalars().all()
    return [
        InvitationOut(
            id=i.id,
            email=i.email,
            role=i.role.value,
            expires_at=i.expires_at,
            created_at=i.created_at,
        )
        for i in invs
    ]


@router.delete("/{org_id}/invitations/{inv_id}", status_code=204)
async def revoke_invitation(
    org_id: int,
    inv_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_membership(db, user.id, org_id, OrgRole.admin)
    result = await db.execute(
        select(Invitation).where(
            Invitation.id == inv_id,
            Invitation.organization_id == org_id,
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    await db.delete(inv)
    await db.commit()


@router.post("/invitations/{token}/accept", response_model=OrgSummary)
async def accept_invitation(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Accept an invitation — creates membership + deletes invitation."""
    result = await db.execute(select(Invitation).where(Invitation.token == token))
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found or already used")

    if inv.expires_at < datetime.now(timezone.utc):
        await db.delete(inv)
        await db.commit()
        raise HTTPException(status_code=410, detail="Invitation has expired")

    # Must match the invited email
    if inv.email.lower() != user.email.lower():
        raise HTTPException(status_code=403, detail="This invitation was sent to a different email address")

    # Verify not already a member
    existing = await db.execute(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == inv.organization_id,
        )
    )
    if existing.scalar_one_or_none():
        await db.delete(inv)
        await db.commit()
        raise HTTPException(status_code=400, detail="You are already a member of this organization")

    membership = Membership(
        user_id=user.id,
        organization_id=inv.organization_id,
        role=inv.role,
    )
    db.add(membership)
    await db.delete(inv)
    await db.commit()

    # Return the org summary
    org_result = await db.execute(select(Organization).where(Organization.id == inv.organization_id))
    org = org_result.scalar_one()
    return await _org_summary(db, org, membership.role)


@router.post("/invitations/{token}/decline", status_code=204)
async def decline_invitation(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Invitation).where(Invitation.token == token))
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if inv.email.lower() != user.email.lower():
        raise HTTPException(status_code=403, detail="Not your invitation")
    await db.delete(inv)
    await db.commit()


# Public endpoint: get invitation details by token (to show "Org X invited you" page)
@router.get("/invitations/{token}")
async def get_invitation(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint — no auth required so unauthenticated users can see
    an invitation before signing up."""
    result = await db.execute(
        select(Invitation, Organization)
        .join(Organization, Organization.id == Invitation.organization_id)
        .where(Invitation.token == token)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Invitation not found")
    inv, org = row
    if inv.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Invitation has expired")
    return {
        "org_name": org.name,
        "org_slug": org.slug,
        "email": inv.email,
        "role": inv.role.value,
        "expires_at": inv.expires_at.isoformat(),
    }
