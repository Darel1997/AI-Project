"use client";

/**
 * MarketingFooter — the public-page footer.
 *
 * Two variants:
 *   - <MarketingFooter />            ← rich 4-column footer (used on / homepage)
 *   - <MarketingFooter compact />    ← single-row footer with copyright + key links
 *                                      (used on /pricing, /blog, /security, /enterprise,
 *                                      /changelog, /status, and any sub-page)
 *
 * Centralizing this means link sets, ordering, copyright year, and the
 * "All systems operational" indicator all stay in lockstep across pages.
 * Previously each page rolled its own footer and they had drifted on:
 *   - which links to include and in what order
 *   - whether to show the logo and copyright
 *   - border color (border-white/5 vs border-surface-border)
 *   - top margin (mt-8 vs mt-12)
 *   - whether to wrap in <nav aria-label="Footer"> for screen readers
 */

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

export function MarketingFooter({ compact = false }: { compact?: boolean }) {
  return compact ? <CompactFooter /> : <FullFooter />;
}

/* ────────────────────────────────────────────────────────────────────
   Full footer — 4-column with logo, link groups, system status
   ──────────────────────────────────────────────────────────────────── */

function FullFooter() {
  const { user } = useAuth();
  const year = new Date().getFullYear();

  return (
    <footer className="relative z-10 border-t border-white/5 mt-12">
      <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-2 sm:grid-cols-4 gap-8">
        <div className="col-span-2 sm:col-span-1">
          <div className="flex items-center gap-2.5 mb-4">
            <FooterLogo />
            <span className="font-semibold">RepoInsight</span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            AI-powered codebase intelligence for engineering teams.
          </p>
        </div>

        <FooterCol title="Product" items={[
          { label: "Features",     href: "/#features" },
          { label: "Pricing",      href: "/pricing" },
          { label: "Changelog",    href: "/changelog" },
        ]} />

        <FooterCol title="Company" items={[
          { label: "Enterprise",     href: "/enterprise" },
          { label: "Blog",           href: "/blog" },
          { label: "Contact sales",  href: "mailto:sales@repoinsight.ai" },
        ]} />

        <FooterCol title="Trust" items={[
          { label: "Security",       href: "/security" },
          { label: "System status",  href: "/status" },
          { label: user ? "Dashboard" : "Log in", href: user ? "/dashboard" : "/auth?mode=login" },
        ]} />
      </div>

      <div className="border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-text-muted">
          <span>© {year} RepoInsight AI. All rights reserved.</span>
          <Link href="/status" className="flex items-center gap-2 hover:text-text-primary transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald animate-pulse" aria-hidden="true" />
            All systems operational
          </Link>
        </div>
      </div>
    </footer>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Compact footer — single row, used on every non-homepage public page
   ──────────────────────────────────────────────────────────────────── */

function CompactFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 border-t border-white/5 mt-12">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <FooterLogo small />
          <span>© {year} RepoInsight AI</span>
        </div>
        <nav aria-label="Footer" className="flex items-center gap-5 flex-wrap justify-center">
          <Link href="/"          className="hover:text-text-primary transition-colors">Home</Link>
          <Link href="/pricing"   className="hover:text-text-primary transition-colors">Pricing</Link>
          <Link href="/blog"      className="hover:text-text-primary transition-colors">Blog</Link>
          <Link href="/security"  className="hover:text-text-primary transition-colors">Security</Link>
          <Link href="/changelog" className="hover:text-text-primary transition-colors">Changelog</Link>
          <Link href="/status"    className="hover:text-text-primary transition-colors">Status</Link>
        </nav>
      </div>
    </footer>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Internals
   ──────────────────────────────────────────────────────────────────── */

function FooterCol({ title, items }: { title: string; items: { label: string; href: string }[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">{title}</h3>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.href + item.label}>
            <Link href={item.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterLogo({ small = false }: { small?: boolean }) {
  const size = small ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-[13px]";
  return (
    <div className={`relative ${size} rounded-lg bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold shadow-glow-sm`}>
      RI
    </div>
  );
}
