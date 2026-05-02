"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { billing, SubscriptionView } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

/* ── Plan metadata ────────────────────────────────────────────── */
const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
};

const PLAN_COLORS: Record<string, string> = {
  free: "text-text-secondary",
  pro: "text-accent",
  team: "text-violet",
  business: "text-cyan",
  enterprise: "text-emerald",
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active:     { label: "Active",          cls: "badge-emerald" },
  trialing:   { label: "In trial",        cls: "badge-blue" },
  past_due:   { label: "Payment overdue", cls: "badge-red" },
  canceled:   { label: "Canceled",        cls: "badge-gray" },
  unpaid:     { label: "Unpaid",          cls: "badge-red" },
  incomplete: { label: "Incomplete",      cls: "badge-yellow" },
  paused:     { label: "Paused",          cls: "badge-yellow" },
};

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingSkeleton />}>
      <BillingInner />
    </Suspense>
  );
}

function BillingInner() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    // If they just returned from Stripe successfully, refresh after a short delay
    // (to give the webhook a chance to land)
    const success = params.get("success") === "1";
    const delay = success ? 1500 : 0;
    const t = setTimeout(async () => {
      try {
        const s = await billing.getSubscription();
        setSub(s);
        if (success) {
          toast.success("Welcome aboard!", `Your ${PLAN_NAMES[s.tier]} plan is now active.`);
          // Clean the URL
          router.replace("/settings/billing");
        }
      } catch (e: any) {
        toast.error("Could not load billing info", e.message);
      } finally {
        setLoading(false);
      }
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPortal() {
    setManaging(true);
    try {
      const { portal_url, mock } = await billing.createPortal();
      if (mock) {
        toast.info("Mock mode", "Real Stripe portal requires STRIPE_SECRET_KEY in backend env.");
      }
      window.location.href = portal_url;
    } catch (e: any) {
      toast.error("Could not open portal", e.message);
      setManaging(false);
    }
  }

  if (loading) return <BillingSkeleton />;
  if (!sub) return null;

  const statusInfo = STATUS_LABELS[sub.status] || { label: sub.status, cls: "badge-gray" };
  const isFree = sub.tier === "free";
  const isPaid = !isFree && sub.status === "active";
  const isPastDue = sub.status === "past_due" || sub.status === "unpaid";

  return (
    <div className="max-w-3xl space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm transition-colors mb-4">
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M13 16l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Settings
        </Link>
        <p className="eyebrow mb-3">
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="5" width="16" height="11" rx="1.5" />
            <path d="M2 9h16" strokeLinecap="round" />
          </svg>
          Billing
        </p>
        <h1 className="text-display-3">Plan &amp; usage</h1>
        <p className="text-text-secondary mt-1.5">Manage your subscription, billing cycle, and invoices.</p>
      </div>

      {/* Past due alert */}
      {isPastDue && (
        <div role="alert" className="card p-4 border-danger/40 bg-danger/5 flex items-start gap-3">
          <svg className="w-5 h-5 text-danger shrink-0 mt-0.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6v4M10 14h.01" strokeLinecap="round" />
          </svg>
          <div className="flex-1">
            <p className="font-semibold text-sm">Payment overdue</p>
            <p className="text-sm text-text-secondary mt-1">Your most recent payment failed. Update your card to keep your plan active.</p>
          </div>
          <button onClick={openPortal} disabled={managing} className="btn-danger text-sm shrink-0">
            Update payment
          </button>
        </div>
      )}

      {/* Current plan card */}
      <section className="card-glass p-6 space-y-5 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-accent/15 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wider font-semibold">Current plan</p>
            <div className="flex items-center gap-3 mt-1.5">
              <h2 className={`text-2xl font-bold ${PLAN_COLORS[sub.tier]}`}>{PLAN_NAMES[sub.tier]}</h2>
              <span className={statusInfo.cls}>{statusInfo.label}</span>
            </div>
            {sub.billing_cycle && (
              <p className="text-sm text-text-secondary mt-1 capitalize">
                {sub.billing_cycle} billing · {sub.seats} {sub.seats === 1 ? "seat" : "seats"}
              </p>
            )}
            {sub.current_period_end && (
              <p className="text-xs text-text-muted mt-1">
                {sub.cancel_at_period_end ? "Cancels on " : "Renews on "}
                {new Date(sub.current_period_end).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {isFree ? (
              <Link href="/pricing" className="btn-glow text-sm">
                Upgrade
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ) : isPaid ? (
              <>
                <Link href="/pricing" className="btn-secondary text-sm">Change plan</Link>
                <button onClick={openPortal} disabled={managing} className="btn-primary text-sm disabled:opacity-50">
                  {managing ? "Opening…" : "Manage billing"}
                </button>
              </>
            ) : (
              <Link href="/pricing" className="btn-primary text-sm">Reactivate</Link>
            )}
          </div>
        </div>
      </section>

      {/* Plan limits + usage */}
      <section className="card p-6 space-y-5">
        <h2 className="font-semibold">Plan limits</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <LimitRow
            label="Repositories"
            limit={sub.limits.repos}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="6" height="6" /><rect x="11" y="3" width="6" height="6" /><rect x="3" y="11" width="6" height="6" /><rect x="11" y="11" width="6" height="6" /></svg>}
          />
          <LimitRow
            label="AI messages / month"
            limit={sub.limits.ai_messages_per_month}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M17 11a2 2 0 01-2 2H6l-3 3V5a2 2 0 012-2h10a2 2 0 012 2z" strokeLinejoin="round" /></svg>}
          />
          <LimitRow
            label="Team members"
            limit={sub.limits.members}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 17v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" /><circle cx="8" cy="6" r="3" /></svg>}
          />
          <LimitRow
            label="Private repositories"
            limit={sub.limits.private_repos ? -1 : 0}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="9" width="14" height="9" rx="1.5" /><path d="M6 9V6a4 4 0 018 0v3" /></svg>}
            binary
          />
        </div>
      </section>

      {/* Upgrade nudge for free users */}
      {isFree && (
        <section className="card-glass p-8 relative overflow-hidden">
          <div className="absolute inset-0 bg-aurora opacity-40 pointer-events-none animate-aurora" aria-hidden="true" />
          <div className="relative space-y-4">
            <h2 className="text-xl font-bold">Ready to scale?</h2>
            <p className="text-text-secondary max-w-xl">
              Upgrade to Pro for private repositories, 10× the AI usage, webhook-triggered re-indexing, and priority support.
            </p>
            <Link href="/pricing" className="btn-glow text-sm">
              See plans &amp; pricing
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </section>
      )}

      {/* Help */}
      <section className="text-center text-xs text-text-muted pt-4">
        Need a custom plan or volume pricing?{" "}
        <a href="mailto:sales@repoinsight.ai" className="text-accent hover:text-accent-hover underline underline-offset-4">
          Contact sales
        </a>
      </section>
    </div>
  );
}

function LimitRow({ label, limit, icon, binary = false }: { label: string; limit: number; icon: React.ReactNode; binary?: boolean }) {
  const isUnlimited = limit === -1;
  const display = binary
    ? (limit === -1 ? "Included" : "Not included")
    : (isUnlimited ? "Unlimited" : limit.toLocaleString());
  const tone = binary
    ? (limit === -1 ? "text-emerald" : "text-text-muted")
    : "text-text-primary";
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-accent-subtle text-accent flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted uppercase tracking-wider font-semibold">{label}</p>
        <p className={`text-sm font-semibold mt-0.5 ${tone}`}>{display}</p>
      </div>
    </div>
  );
}

function BillingSkeleton() {
  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-2">
        <div className="skeleton h-4 w-16" />
        <div className="skeleton h-8 w-48" />
      </div>
      <div className="card p-6 space-y-4">
        <div className="skeleton h-5 w-32" />
        <div className="skeleton h-8 w-24" />
      </div>
      <div className="card p-6 space-y-4">
        <div className="skeleton h-5 w-32" />
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center gap-3">
            <div className="skeleton w-8 h-8 rounded-lg" />
            <div className="space-y-1.5 flex-1">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
