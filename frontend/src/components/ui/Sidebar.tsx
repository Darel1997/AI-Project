"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { billing, FeatureCatalog, SubscriptionView } from "@/lib/api";
import clsx from "clsx";

/* ── Icons ──────────────────────────────────────────────────── */
const DashboardIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);
const ChatIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);
const AnalyticsIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);
const OrgsIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const InsightsIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M8 7l3 9M16 7l-3 9M8 6h8" />
  </svg>
);
const LabIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3v6l-4 9a2 2 0 002 3h10a2 2 0 002-3l-4-9V3" />
    <path d="M9 3h6M9 9h6" />
  </svg>
);
const SearchIcon = () => (
  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);
const MenuIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
const CloseIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

interface NavItem {
  href: string;
  label: string;
  Icon: () => JSX.Element;
  activeOn: string[];
  /** When true, renders a small "New" badge on the right side until the user visits. */
  isNew?: boolean;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard",     Icon: DashboardIcon, activeOn: ["/dashboard", "/repos"] },
  { href: "/chat",      label: "Chat",          Icon: ChatIcon,      activeOn: ["/chat"] },
  { href: "/analytics", label: "Analytics",     Icon: AnalyticsIcon, activeOn: ["/analytics"] },
  { href: "/insights",  label: "Insights",      Icon: InsightsIcon,  activeOn: ["/insights"] },
  { href: "/orgs",      label: "Organizations", Icon: OrgsIcon,      activeOn: ["/orgs"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(typeof navigator !== "undefined" && /mac/i.test(navigator.platform));
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  function openCommandPalette() {
    const evt = new KeyboardEvent("keydown", { key: "k", metaKey: mac, ctrlKey: !mac, bubbles: true });
    window.dispatchEvent(evt);
  }

  return (
    <>
      {/* ── Mobile top bar ───────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-20 bg-surface-raised/80 backdrop-blur-xl border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-xs shadow-glow-sm">RI</div>
          <span className="font-semibold text-sm">RepoInsight</span>
        </Link>
        <button
          onClick={() => setMobileOpen(true)}
          className="btn-ghost p-2"
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
        >
          <MenuIcon />
        </button>
      </header>

      {/* ── Mobile drawer backdrop ────────────────────── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ───────────────────────────────────── */}
      <aside
        className={clsx(
          "w-64 h-screen flex flex-col fixed left-0 top-0 z-40 transition-transform duration-300 ease-smooth",
          "bg-surface-raised/60 backdrop-blur-2xl border-r border-white/5",
          "lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        aria-label="Main navigation"
      >
        {/* Ambient accent glow at top */}
        <div className="absolute top-0 left-0 right-0 h-48 pointer-events-none opacity-60"
          style={{ background: "radial-gradient(ellipse 100% 100% at 50% 0%, rgba(124,107,255,0.15), transparent 70%)" }}
          aria-hidden="true" />

        {/* Logo + mobile close */}
        <div className="relative px-4 py-4 border-b border-white/5 shrink-0 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-sm shadow-glow-sm group-hover:shadow-glow transition-shadow">
              <span className="relative z-10">RI</span>
              <div className="absolute inset-0 rounded-xl bg-gradient-conic opacity-0 group-hover:opacity-30 animate-spin-slow" aria-hidden="true" />
            </div>
            <div>
              <div className="font-semibold tracking-tight text-[15px]">RepoInsight</div>
              <div className="text-[10px] text-text-muted tracking-wider uppercase flex items-center gap-1">
                <span className="status-dot bg-emerald" style={{ background: "#34d399" }} />
                Online
              </div>
            </div>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden btn-ghost p-1"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Command palette launcher */}
        <div className="relative px-3 pt-3 shrink-0">
          <button
            onClick={openCommandPalette}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-muted hover:text-text-primary bg-surface-sunken/60 border border-white/5 hover:border-white/10 rounded-lg transition-all group"
          >
            <SearchIcon />
            <span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="kbd opacity-70 group-hover:opacity-100">{mac ? "⌘" : "Ctrl"}</kbd>
            <kbd className="kbd opacity-70 group-hover:opacity-100">K</kbd>
          </button>
        </div>

        {/* Primary nav */}
        <nav className="relative flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" aria-label="Primary">
          <p className="section-heading px-3 mb-2">Workspace</p>
          {NAV.map((item) => {
            const active = item.activeOn.some(p => pathname === p || pathname.startsWith(p + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 relative group",
                  active
                    ? "bg-accent/10 text-text-primary shadow-inset-border"
                    : "text-text-secondary hover:text-text-primary hover:bg-white/[0.03]"
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-gradient-to-b from-violet to-accent rounded-r-full shadow-glow-sm" aria-hidden="true" />
                )}
                <span className={active ? "text-accent" : "text-text-muted group-hover:text-text-primary transition-colors"}>
                  <item.Icon />
                </span>
                <span className="flex-1">{item.label}</span>
                {item.isNew && !active && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald bg-emerald-subtle px-1.5 py-0.5 rounded">New</span>
                )}
                {active && (
                  <span className="w-1 h-1 rounded-full bg-accent animate-pulse" aria-hidden="true" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Plan badge — live data via /api/billing/features + usage tracking */}
        <PlanWidget />

        {/* User + home + sign out */}
        <div className="relative px-3 pt-3 pb-5 border-t border-white/5 shrink-0">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white/[0.03] transition-colors group"
          >
            {user?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full ring-1 ring-white/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white text-sm font-bold ring-1 ring-white/10">
                {(user?.full_name || user?.email || "U")[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate group-hover:text-accent transition-colors">{user?.full_name || user?.email}</p>
              <p className="text-xs text-text-muted truncate">
                {user?.github_username ? `@${user.github_username}` : "Profile & settings"}
              </p>
            </div>
            <svg className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link
            href="/"
            className="w-full mt-1 px-2.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.03] transition-colors rounded-lg flex items-center gap-3"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12l9-9 9 9" />
              <path d="M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10" />
            </svg>
            Back to site
          </Link>
          <button
            onClick={logout}
            className="w-full mt-1 px-2.5 py-2 text-sm font-medium text-text-secondary hover:text-danger hover:bg-danger/5 transition-colors rounded-lg flex items-center gap-3"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * PlanWidget — live tier + AI usage indicator in the sidebar.
 * Three display modes:
 *   - Owner   → Gold "Owner" badge with infinity symbol, no usage cap
 *   - Paid    → Plan name + usage bar (Pro/Team/Business)
 *   - Free    → Plan name + usage bar + Upgrade link
 * Refreshes every 60s so subscription changes show up promptly.
 */
function PlanWidget() {
  const [catalog, setCatalog] = useState<FeatureCatalog | null>(null);
  const [sub, setSub] = useState<SubscriptionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [c, s] = await Promise.all([
          billing.getFeatures(),
          billing.getSubscription(),
        ]);
        if (!cancelled) { setCatalog(c); setSub(s); }
      } catch { /* fail silent — widget just renders skeleton */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Loading skeleton — keeps layout stable
  if (!catalog || !sub) {
    return (
      <div className="relative px-3 pb-3 shrink-0">
        <div className="card-glass p-3 space-y-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-1 w-full" />
        </div>
      </div>
    );
  }

  const isOwner = catalog.is_owner;
  const tier = catalog.current_tier;
  const tierLabel = isOwner ? "Owner" : tier.charAt(0).toUpperCase() + tier.slice(1);
  // Real usage tracking is a future enhancement; for now the API exposes the limit and
  // we treat usage as 0 so the bar reflects the cap, not a fabricated consumption number.
  const limit = sub.limits.ai_messages_per_month;
  const unlimited = isOwner || limit === -1;

  return (
    <div className="relative px-3 pb-3 shrink-0">
      <div className="card-glass p-3 text-sm">
        <div className="flex items-center justify-between mb-1.5">
          <span className={`text-xs font-semibold flex items-center gap-1.5 ${
            isOwner ? "text-accent" : "text-text-secondary"
          }`}>
            {isOwner && (
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2 7l4 3 4-6 4 6 4-3-2 9H4z" />
              </svg>
            )}
            {tierLabel}{!isOwner && " plan"}
          </span>
          {!isOwner && tier === "free" && (
            <Link
              href="/pricing"
              className="text-[10px] text-accent hover:text-accent-hover transition-colors uppercase tracking-wider font-semibold"
            >
              Upgrade
            </Link>
          )}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-text-muted">
            <span>AI messages</span>
            <span className="font-mono">
              {unlimited ? (
                <span className="text-accent font-semibold">∞ unlimited</span>
              ) : (
                <span>0 / {limit.toLocaleString()}</span>
              )}
            </span>
          </div>
          <div className="h-1 bg-surface-sunken rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                isOwner
                  ? "bg-gradient-to-r from-accent via-violet to-cyan w-full animate-aurora"
                  : "bg-gradient-to-r from-violet to-accent"
              }`}
              style={{ width: unlimited ? "100%" : "0%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
