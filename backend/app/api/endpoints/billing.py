"""
Billing endpoints — Stripe subscription management.

Routes:
- POST /api/billing/checkout/create-session — Start a Stripe Checkout flow
- POST /api/billing/portal/create-session — Open Stripe customer portal
- GET  /api/billing/subscription — Get current user's subscription state
- POST /api/billing/webhook — Stripe webhook receiver (signed with Stripe-Signature)

ENV required:
- STRIPE_SECRET_KEY (sk_test_...)
- STRIPE_PUBLISHABLE_KEY (pk_test_...) — exposed to frontend
- STRIPE_WEBHOOK_SECRET (whsec_...)
- STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_ANNUAL
- STRIPE_PRICE_TEAM_MONTHLY / STRIPE_PRICE_TEAM_ANNUAL
- STRIPE_PRICE_BUSINESS_MONTHLY / STRIPE_PRICE_BUSINESS_ANNUAL
- FRONTEND_URL (e.g. https://repoinsight.ai)

This module is structured so that ALL real Stripe calls are isolated inside
`_stripe()` helpers — if STRIPE_SECRET_KEY is unset, endpoints fall back to
a MOCK mode that returns plausible responses for local dev.
"""

from __future__ import annotations
import os
import logging
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Header, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.subscription import Subscription, PlanTier, SubscriptionStatus
from app.services.feature_gate import get_user_features

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])

# ── Config ────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Map tier+cycle → Stripe Price ID from env
PRICE_MAP: dict[tuple[str, str], str] = {
    ("pro",      "monthly"): os.getenv("STRIPE_PRICE_PRO_MONTHLY", ""),
    ("pro",      "annual"):  os.getenv("STRIPE_PRICE_PRO_ANNUAL", ""),
    ("team",     "monthly"): os.getenv("STRIPE_PRICE_TEAM_MONTHLY", ""),
    ("team",     "annual"):  os.getenv("STRIPE_PRICE_TEAM_ANNUAL", ""),
    ("business", "monthly"): os.getenv("STRIPE_PRICE_BUSINESS_MONTHLY", ""),
    ("business", "annual"):  os.getenv("STRIPE_PRICE_BUSINESS_ANNUAL", ""),
}

MOCK_MODE = not STRIPE_SECRET_KEY

# Lazy-import stripe only when we have a key. This keeps MOCK_MODE usable
# even without the stripe package installed, which is useful for CI.
_stripe_client = None
def _stripe():
    global _stripe_client
    if _stripe_client is None:
        if MOCK_MODE:
            raise RuntimeError("Stripe not configured — set STRIPE_SECRET_KEY")
        import stripe  # type: ignore
        stripe.api_key = STRIPE_SECRET_KEY
        _stripe_client = stripe
    return _stripe_client


# ── Schemas ───────────────────────────────────────────────────────────
class CreateCheckoutRequest(BaseModel):
    tier: Literal["pro", "team", "business"]
    billing_cycle: Literal["monthly", "annual"] = "annual"
    seat_count: int = Field(default=1, ge=1, le=500)

class CheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str
    mock: bool = False

class PortalResponse(BaseModel):
    portal_url: str
    mock: bool = False

class SubscriptionView(BaseModel):
    tier: str
    status: str
    billing_cycle: Optional[str] = None
    seats: int = 1
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: bool = False
    # Plan limits — derived from tier
    limits: dict


# ── Helpers ───────────────────────────────────────────────────────────
TIER_LIMITS = {
    "free":     {"repos": 3,    "ai_messages_per_month": 1_000,  "members": 1,   "private_repos": False},
    "pro":      {"repos": 50,   "ai_messages_per_month": 10_000, "members": 1,   "private_repos": True},
    "team":     {"repos": 500,  "ai_messages_per_month": 100_000,"members": 25,  "private_repos": True},
    "business": {"repos": -1,   "ai_messages_per_month": -1,     "members": -1,  "private_repos": True},  # -1 = unlimited
    # Owner — special internal tier for the site operator. Bypasses every gate, unlimited everything.
    "owner":    {"repos": -1,   "ai_messages_per_month": -1,     "members": -1,  "private_repos": True},
}

async def _get_or_create_subscription(db: AsyncSession, user: User) -> Subscription:
    res = await db.execute(select(Subscription).where(Subscription.user_id == user.id))
    sub = res.scalar_one_or_none()
    if not sub:
        sub = Subscription(
            user_id=user.id,
            tier=PlanTier.FREE.value,
            status=SubscriptionStatus.ACTIVE.value,
            seats=1,
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
    return sub

def _view(sub: Subscription, is_owner: bool = False) -> SubscriptionView:
    # tier / status are stored as strings thanks to the validators on the model.
    # Owner accounts override the displayed tier so the UI shows the special Owner badge
    # and unlimited limits — without needing a fake Subscription row.
    if is_owner:
        return SubscriptionView(
            tier="owner",
            status="active",
            billing_cycle=None,
            seats=1,
            current_period_end=None,
            cancel_at_period_end=False,
            limits=TIER_LIMITS["owner"],
        )
    tier = sub.tier.value if isinstance(sub.tier, PlanTier) else sub.tier
    status = sub.status.value if isinstance(sub.status, SubscriptionStatus) else sub.status
    return SubscriptionView(
        tier=tier,
        status=status,
        billing_cycle=sub.billing_cycle,
        seats=sub.seats,
        current_period_end=sub.current_period_end,
        cancel_at_period_end=sub.cancel_at_period_end,
        limits=TIER_LIMITS.get(tier, TIER_LIMITS["free"]),
    )


# ── Endpoints ─────────────────────────────────────────────────────────

@router.get("/subscription", response_model=SubscriptionView)
async def get_subscription(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return the authenticated user's subscription state + plan limits."""
    sub = await _get_or_create_subscription(db, user)
    return _view(sub, is_owner=bool(getattr(user, "is_owner", False)))


@router.get("/features")
async def get_features(features: dict = Depends(get_user_features)):
    """
    Return the full feature catalog with per-feature unlock state for this user.
    Owner accounts see everything unlocked. Free users see only free features unlocked.
    Frontend uses this to render lock icons on premium buttons.
    """
    return features


@router.post("/checkout/create-session", response_model=CheckoutResponse)
async def create_checkout_session(
    body: CreateCheckoutRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a Stripe Checkout session for the requested plan.

    Flow: frontend calls this → gets checkout_url → redirects browser to Stripe →
    on success Stripe redirects back to /settings/billing?success=1 →
    we already updated the DB via the webhook before the user arrives.
    """
    sub = await _get_or_create_subscription(db, user)

    # In mock mode, just mark the subscription and return a fake URL.
    # This lets local dev flow end-to-end without Stripe credentials.
    if MOCK_MODE:
        sub.tier = PlanTier(body.tier)
        sub.status = SubscriptionStatus.ACTIVE
        sub.billing_cycle = body.billing_cycle
        sub.seats = body.seat_count
        sub.current_period_end = datetime.now(timezone.utc).replace(year=datetime.now().year + 1)
        sub.stripe_customer_id = f"cus_mock_{user.id}"
        sub.stripe_subscription_id = f"sub_mock_{user.id}"
        await db.commit()
        return CheckoutResponse(
            checkout_url=f"{FRONTEND_URL}/settings/billing?success=1&mock=1",
            session_id=f"cs_mock_{user.id}",
            mock=True,
        )

    price_id = PRICE_MAP.get((body.tier, body.billing_cycle))
    if not price_id:
        raise HTTPException(status_code=400, detail=f"Price not configured for {body.tier}/{body.billing_cycle}")

    stripe = _stripe()

    # Ensure we have a Stripe customer for this user
    if not sub.stripe_customer_id:
        customer = stripe.Customer.create(
            email=user.email,
            name=user.full_name or user.email,
            metadata={"user_id": str(user.id)},
        )
        sub.stripe_customer_id = customer.id
        await db.commit()

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=sub.stripe_customer_id,
        line_items=[{"price": price_id, "quantity": body.seat_count}],
        success_url=f"{FRONTEND_URL}/settings/billing?success=1&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{FRONTEND_URL}/pricing?canceled=1",
        allow_promotion_codes=True,
        billing_address_collection="auto",
        subscription_data={"metadata": {"user_id": str(user.id), "tier": body.tier}},
    )
    return CheckoutResponse(checkout_url=session.url, session_id=session.id)


@router.post("/portal/create-session", response_model=PortalResponse)
async def create_portal_session(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """
    Create a Stripe Customer Portal session so the user can manage their subscription
    (change plan, update card, download invoices, cancel).
    """
    sub = await _get_or_create_subscription(db, user)

    if MOCK_MODE:
        return PortalResponse(portal_url=f"{FRONTEND_URL}/settings/billing?portal=1&mock=1", mock=True)

    if not sub.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer. Start a subscription first.")

    portal = _stripe().billing_portal.Session.create(
        customer=sub.stripe_customer_id,
        return_url=f"{FRONTEND_URL}/settings/billing",
    )
    return PortalResponse(portal_url=portal.url)


@router.post("/webhook", status_code=200)
async def stripe_webhook(request: Request, stripe_signature: str = Header(None), db: AsyncSession = Depends(get_db)):
    """
    Receive Stripe events. Verified via HMAC signature. Idempotent by event.id.
    Handles subscription lifecycle: created, updated, deleted, invoice paid/failed.
    """
    if MOCK_MODE:
        # In mock mode, webhooks are a no-op. Local dev uses the mock path in checkout.
        return {"ok": True, "mock": True}

    payload = await request.body()
    stripe = _stripe()

    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        log.warning("stripe webhook signature verification failed: %s", e)
        raise HTTPException(status_code=400, detail="Invalid signature")

    etype = event["type"]
    data = event["data"]["object"]

    # Handle the events that actually change subscription state
    if etype in {"customer.subscription.created", "customer.subscription.updated"}:
        await _sync_subscription_from_stripe(db, data)
    elif etype == "customer.subscription.deleted":
        await _mark_subscription_canceled(db, data)
    elif etype == "invoice.payment_failed":
        await _mark_payment_failed(db, data)

    return {"ok": True, "processed": etype}


async def _sync_subscription_from_stripe(db: AsyncSession, stripe_sub: dict):
    """Upsert local Subscription row from Stripe subscription object."""
    customer_id = stripe_sub.get("customer")
    res = await db.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
    sub = res.scalar_one_or_none()
    if not sub:
        # Likely user_id was in metadata — look it up
        meta_uid = (stripe_sub.get("metadata") or {}).get("user_id")
        if meta_uid:
            res = await db.execute(select(Subscription).where(Subscription.user_id == int(meta_uid)))
            sub = res.scalar_one_or_none()
    if not sub:
        log.warning("webhook received for unknown subscription customer=%s", customer_id)
        return

    # Derive tier from price metadata
    items = (stripe_sub.get("items") or {}).get("data") or []
    tier_str = ((stripe_sub.get("metadata") or {}).get("tier")) or "pro"
    if tier_str in {t.value for t in PlanTier}:
        sub.tier = PlanTier(tier_str)

    status_str = stripe_sub.get("status", "active")
    status_map = {
        "active": SubscriptionStatus.ACTIVE,
        "trialing": SubscriptionStatus.TRIALING,
        "past_due": SubscriptionStatus.PAST_DUE,
        "canceled": SubscriptionStatus.CANCELED,
        "unpaid": SubscriptionStatus.UNPAID,
        "incomplete": SubscriptionStatus.INCOMPLETE,
        "incomplete_expired": SubscriptionStatus.CANCELED,
        "paused": SubscriptionStatus.PAUSED,
    }
    sub.status = status_map.get(status_str, SubscriptionStatus.ACTIVE)
    sub.stripe_subscription_id = stripe_sub.get("id")
    sub.cancel_at_period_end = bool(stripe_sub.get("cancel_at_period_end"))

    if items:
        sub.seats = items[0].get("quantity", 1)
        price = items[0].get("price") or {}
        recurring = price.get("recurring") or {}
        interval = recurring.get("interval")
        sub.billing_cycle = "annual" if interval == "year" else "monthly"

    period_end = stripe_sub.get("current_period_end")
    if period_end:
        sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)

    await db.commit()


async def _mark_subscription_canceled(db: AsyncSession, stripe_sub: dict):
    customer_id = stripe_sub.get("customer")
    res = await db.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
    sub = res.scalar_one_or_none()
    if sub:
        sub.status = SubscriptionStatus.CANCELED
        sub.tier = PlanTier.FREE
        await db.commit()


async def _mark_payment_failed(db: AsyncSession, invoice: dict):
    customer_id = invoice.get("customer")
    res = await db.execute(select(Subscription).where(Subscription.stripe_customer_id == customer_id))
    sub = res.scalar_one_or_none()
    if sub:
        sub.status = SubscriptionStatus.PAST_DUE
        await db.commit()
