"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { billing } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";
export default function PricingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <PricingInner />
    </Suspense>
  );
}

function PricingInner() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("annual");
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [checkoutTier, setCheckoutTier] = useState<string | null>(null);

  // Auto-checkout: when coming back from registration with ?auto_checkout=pro,
  // fire the checkout flow immediately. Keeps "Start Pro" feeling seamless even
  // across a sign-up detour.
  useEffect(() => {
    if (authLoading || !user) return;
    const auto = params.get("auto_checkout");
    if (auto === "pro" || auto === "team" || auto === "business") {
      router.replace("/pricing"); // clean URL first
      handleCheckout(auto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  async function handleCheckout(tier: "pro" | "team" | "business") {
    // Not signed in → send to registration, then back here
    if (!user) {
      router.push(`/auth?mode=register&next=${encodeURIComponent(`/pricing?auto_checkout=${tier}`)}`);
      return;
    }
    setCheckoutTier(tier);
    try {
      const { checkout_url, mock } = await billing.createCheckout(tier, billingCycle, 1);
      if (mock) {
        toast.info("Mock checkout", "Using test mode — your plan has been updated locally.");
      }
      window.location.href = checkout_url;
    } catch (e: any) {
      toast.error("Could not start checkout", e.message);
      setCheckoutTier(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      {/* Nav */}
      <MarketingNav />

      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section className="relative max-w-5xl mx-auto px-6 pt-20 pb-8 text-center">
          <div className="absolute inset-0 bg-aurora opacity-50 pointer-events-none" aria-hidden="true" />
          <div className="relative">
            <p className="eyebrow mb-6">
              <span className="status-dot" aria-hidden="true" />
              Simple pricing
            </p>
            <h1 className="text-display-2 text-balance">Pricing that scales with you</h1>
            <p className="text-lg text-text-secondary mt-4 max-w-2xl mx-auto text-pretty">
              Free for public repos and personal projects. Pay only when you need private repos or team features.
            </p>

            {/* Billing toggle */}
            <div className="inline-flex items-center gap-1 mt-8 p-1 bg-surface-overlay/60 backdrop-blur-xl rounded-lg border border-white/10" role="radiogroup" aria-label="Billing cycle">
              <button
                role="radio"
                aria-checked={billingCycle === "monthly"}
                onClick={() => setBillingCycle("monthly")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  billingCycle === "monthly" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
              >
                Monthly
              </button>
              <button
                role="radio"
                aria-checked={billingCycle === "annual"}
                onClick={() => setBillingCycle("annual")}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                  billingCycle === "annual" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                }`}
              >
                Annual
                <span className="badge-emerald text-[10px]">Save 20%</span>
              </button>
            </div>
          </div>
        </section>

        {/* Plans */}
        <section className="max-w-6xl mx-auto px-6 py-12" aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="sr-only">Pricing plans</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map(plan => (
              <PlanCard
                key={plan.name}
                plan={plan}
                billingCycle={billingCycle}
                onCheckout={handleCheckout}
                loading={checkoutTier === plan.tier}
              />
            ))}
          </div>
          <p className="text-center text-xs text-text-muted mt-8">
            Cancel anytime. Prices in USD. Compliance roadmap on the <Link href="/security" className="text-accent hover:text-accent-hover">security page</Link>.
          </p>
        </section>

        {/* Business / Enterprise tier — full-width card with contact-sales */}
        <section className="max-w-6xl mx-auto px-6 py-12" aria-labelledby="business-heading">
          <div className="card-glass p-8 sm:p-10 relative overflow-hidden">
            <div className="absolute -top-32 -right-32 w-80 h-80 bg-cyan/15 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
            <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-emerald/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
            <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-start">
              <div className="space-y-5 max-w-2xl">
                <div className="flex items-center gap-3">
                  <span className="badge-cyan">Business</span>
                  <h2 id="business-heading" className="text-2xl font-bold">Custom pricing for your team</h2>
                </div>
                <p className="text-text-secondary">
                  For organizations that need enterprise-grade security, compliance, and dedicated support. Volume pricing, annual contracts, and on-premise deployment options available.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {BUSINESS_PLAN.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
                      <svg className="w-4 h-4 text-emerald shrink-0 mt-0.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <a href="mailto:sales@repoinsight.ai?subject=Business%20plan%20inquiry" className="btn-primary text-sm">
                  Contact sales
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
                <button onClick={() => handleCheckout("business")} disabled={checkoutTier === "business"} className="btn-secondary text-sm disabled:opacity-50">
                  {checkoutTier === "business" ? "Opening…" : "Start self-serve"}
                </button>
                <p className="text-[10px] text-text-muted text-center mt-1">Cross-repo intelligence + compliance evidence</p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature comparison table */}
        <section className="max-w-5xl mx-auto px-6 py-12" aria-labelledby="compare-heading">
          <div className="text-center mb-10">
            <p className="section-heading mb-3">Compare plans</p>
            <h2 id="compare-heading" className="text-display-3">Every feature side-by-side</h2>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border">
                    <th scope="col" className="text-left px-4 sm:px-6 py-4 font-semibold">Feature</th>
                    <th scope="col" className="text-center px-4 sm:px-6 py-4 font-semibold">Free</th>
                    <th scope="col" className="text-center px-4 sm:px-6 py-4 font-semibold text-accent">Pro</th>
                    <th scope="col" className="text-center px-4 sm:px-6 py-4 font-semibold">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row, i) => {
                    if (row.group) {
                      return (
                        <tr key={i} className="bg-surface-overlay/40">
                          <td colSpan={4} className="px-4 sm:px-6 py-2 section-heading">
                            {row.group}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={i} className="border-b border-surface-border/50 last:border-0">
                        <td className="px-4 sm:px-6 py-3 text-text-secondary">{row.feature}</td>
                        <td className="px-4 sm:px-6 py-3 text-center"><Cell v={row.free} /></td>
                        <td className="px-4 sm:px-6 py-3 text-center"><Cell v={row.pro} /></td>
                        <td className="px-4 sm:px-6 py-3 text-center"><Cell v={row.team} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-6 py-16" aria-labelledby="faq-heading">
          <div className="text-center mb-10">
            <p className="section-heading mb-3">FAQ</p>
            <h2 id="faq-heading" className="text-display-3">Common questions</h2>
          </div>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <details key={i} className="card p-5 group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold list-none">
                  {f.q}
                  <svg className="w-4 h-4 text-text-muted group-open:rotate-180 transition-transform shrink-0 ml-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <p className="text-sm text-text-secondary mt-3 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-3xl mx-auto px-6 py-20">
          <div className="card p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-hero-gradient opacity-60 pointer-events-none" aria-hidden="true" />
            <div className="relative space-y-4">
              <h2 className="text-display-3">Start free today</h2>
              <p className="text-text-secondary text-pretty">No credit card required. Upgrade when you need private repos or team features.</p>
              <Link href="/auth?mode=register" className="btn-primary text-base px-6 py-3 shadow-glow-sm hover:shadow-glow">
                Create an Account for Free
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter compact />
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */

interface Plan {
  name: string;
  tier: "free" | "pro" | "team" | "business";
  tagline: string;
  monthly: number;
  annual: number;
  cta: string;
  popular?: boolean;
  features: string[];
}

const PLANS: Plan[] = [
  {
    name: "Free",
    tier: "free",
    tagline: "For solo devs exploring public code",
    monthly: 0,
    annual: 0,
    cta: "Get started",
    features: [
      "Up to 3 public repositories",
      "Chat with repo + citations",
      "Auto-generated documentation",
      "Security + code quality audits",
      "Architecture diagrams",
      "1,000 AI messages / month",
    ],
  },
  {
    name: "Pro",
    tier: "pro",
    tagline: "For professionals working in private repos",
    monthly: 19,
    annual: 15,
    cta: "Start Pro",
    popular: true,
    features: [
      "Everything in Free",
      "Up to 50 private repositories",
      "10,000 AI messages / month",
      "Blast Radius impact analysis",
      "Priority indexing (under 30s)",
      "Export reports to PDF",
      "Email support",
    ],
  },
  {
    name: "Team",
    tier: "team",
    tagline: "For engineering teams shipping together",
    monthly: 49,
    annual: 39,
    cta: "Start Team",
    features: [
      "Everything in Pro",
      "Up to 500 repositories",
      "100,000 AI messages / month",
      "Shared team workspaces",
      "Role-based access control",
      "Tribal Knowledge Capture",
      "Onboarding Simulator",
      "Dedicated Slack support",
    ],
  },
];

// Business tier — separate section, contact-sales
const BUSINESS_PLAN = {
  name: "Business",
  tier: "business" as const,
  tagline: "For scale-ups and enterprises",
  features: [
    "Unlimited repositories",
    "Unlimited AI messages",
    "Unlimited team members",
    "Cross-repo intelligence",
    "Compliance evidence reports (SOC 2, GDPR, HIPAA mappings)",
    "Tribal knowledge capture",
    "Slack integration",
    "Priority support",
  ],
};

function PlanCard({ plan, billingCycle, onCheckout, loading }: {
  plan: Plan;
  billingCycle: "monthly" | "annual";
  onCheckout: (tier: "pro" | "team" | "business") => void;
  loading: boolean;
}) {
  const price = billingCycle === "monthly" ? plan.monthly : plan.annual;

  return (
    <div
      className={`relative overflow-hidden rounded-xl transition-all duration-300 ${
        plan.popular
          ? "card-glass ring-1 ring-accent/40 hover:ring-accent/60 shadow-glow-sm hover:shadow-glow"
          : "card hover:border-white/10"
      }`}
    >
      {plan.popular && (
        <>
          <div className="absolute top-0 right-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent" aria-hidden="true" />
          <div className="absolute -top-20 -right-20 w-48 h-48 bg-accent/20 rounded-full blur-3xl" aria-hidden="true" />
        </>
      )}
      <div className="relative p-6 space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold">{plan.name}</h3>
            {plan.popular && <span className="badge-violet">Most popular</span>}
          </div>
          <p className="text-text-muted text-sm mt-1">{plan.tagline}</p>
        </div>

        <div className="py-3 border-y border-white/5">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-5xl font-bold tracking-tight ${plan.popular ? "text-gradient-accent" : ""}`}>
              ${price}
            </span>
            <span className="text-text-muted text-sm">
              {price === 0 ? "forever" : `/mo${billingCycle === "annual" ? " billed yearly" : ""}`}
            </span>
          </div>
        </div>

        {plan.tier === "free" ? (
          <Link href="/auth?mode=register" className="btn-secondary w-full justify-center">
            {plan.cta}
          </Link>
        ) : (
          <button
            onClick={() => onCheckout(plan.tier as "pro" | "team" | "business")}
            disabled={loading}
            className={`${plan.popular ? "btn-glow" : "btn-secondary"} w-full justify-center disabled:opacity-50`}
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                Opening checkout…
              </>
            ) : (
              plan.cta
            )}
          </button>
        )}

        <ul className="space-y-2.5" aria-label={`${plan.name} features`}>
          {plan.features.map(f => (
            <li key={f} className="flex items-start gap-2.5 text-sm">
              <svg className="w-4 h-4 text-emerald shrink-0 mt-0.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-text-secondary">{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */

interface CompareRow {
  group?: string;
  feature?: string;
  free?: string | boolean;
  pro?: string | boolean;
  team?: string | boolean;
}

const COMPARE_ROWS: CompareRow[] = [
  { group: "Repositories" },
  { feature: "Public repositories",  free: "Unlimited",  pro: "Unlimited",  team: "Unlimited" },
  { feature: "Private repositories", free: false,        pro: "Unlimited",  team: "Unlimited" },
  { feature: "Indexing speed",       free: "Standard",   pro: "Priority",   team: "Priority" },

  { group: "Free features" },
  { feature: "Chat with repo",        free: true, pro: true, team: true },
  { feature: "Auto documentation",    free: true, pro: true, team: true },
  { feature: "Architecture diagrams", free: true, pro: true, team: true },
  { feature: "Onboarding guides",     free: true, pro: true, team: true },
  { feature: "License scanner + SBOM", free: true, pro: true, team: true },

  { group: "Pro features" },
  { feature: "Security audits",       free: false, pro: true, team: true },
  { feature: "Code quality audits",   free: false, pro: true, team: true },
  { feature: "Task generator",        free: false, pro: true, team: true },
  { feature: "Dependency radar",      free: false, pro: true, team: true },
  { feature: "Time machine",          free: false, pro: true, team: true },
  { feature: "Cost forecaster",       free: false, pro: true, team: true },

  { group: "Team features" },
  { feature: "Onboarding simulator",  free: false, pro: false, team: true },
  { feature: "Blast radius",          free: false, pro: false, team: true },
  { feature: "AI PR reviewer",        free: false, pro: false, team: true },
  { feature: "Knowledge graph search",free: false, pro: false, team: true },
  { feature: "Code drift detection",  free: false, pro: false, team: true },
  { feature: "Living ADRs",           free: false, pro: false, team: true },
  { feature: "Migration assistant",   free: false, pro: false, team: true },

  { group: "Usage Limits" },
  { feature: "AI messages / month", free: "1,000", pro: "10,000", team: "Unlimited" },
  { feature: "Report exports",      free: "Markdown", pro: "Markdown + PDF", team: "Markdown + PDF" },

  { group: "Support" },
  { feature: "Community support",   free: true,  pro: true, team: true },
  { feature: "Email support",       free: false, pro: true, team: true },
];

function Cell({ v }: { v: string | boolean | undefined }) {
  if (v === true) return (
    <svg className="w-4 h-4 text-success inline" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-label="Included">
      <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (v === false || v === undefined) return (
    <span className="text-text-muted" aria-label="Not included">—</span>
  );
  return <span className="text-text-primary text-sm">{v}</span>;
}

/* ─────────────────────────────────────────────────────── */

const FAQ = [
  {
    q: "Do I really need to pay for anything?",
    a: "No — the Free plan is fully featured for public repositories with 1,000 AI messages per month. Most solo developers and open-source maintainers never need to upgrade. You only pay when you need private repos, higher limits, or team features.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. You can cancel your subscription at any time from Settings. You'll keep access until the end of your billing period, and you can always return to the Free plan.",
  },
  {
    q: "Where is my code stored?",
    a: "Your code is indexed on our servers using local embeddings (sentence-transformers) — no code leaves your infrastructure for indexing. When you ask questions, relevant snippets are sent to Anthropic Claude to generate answers. You can self-host if needed.",
  },
  {
    q: "What counts as an AI message?",
    a: "Each chat message, each generated report (docs, security scan, onboarding guide, etc.), and each architecture diagram counts as one message. Indexing is unlimited and free on all plans.",
  },
  {
    q: "Do you offer discounts for students, non-profits, or OSS maintainers?",
    a: "Yes. Contact us at support@repoinsight.ai with proof of status and we'll set you up with Pro for free.",
  },
  {
    q: "Can I switch between plans?",
    a: "Absolutely. Upgrade or downgrade at any time. Pro-rated charges apply on upgrades; credits are applied on downgrades.",
  },
];
