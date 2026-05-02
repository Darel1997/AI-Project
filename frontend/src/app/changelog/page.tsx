"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";

type Kind = "release" | "improvement" | "fix";

interface ChangelogItem {
  text: string;
  area?: string; // optional grouping label, e.g. "Indexing", "API", "UI"
}

interface Entry {
  date: string;
  version: string;
  kind: Kind;
  title: string;
  summary?: string;
  items: ChangelogItem[];
}

/* ────────────────────────────────────────────────────────────────────
   Changelog data — newest first.
   ──────────────────────────────────────────────────────────────────── */

const ENTRIES: Entry[] = [
  {
    date: "2026-04-24",
    version: "v0.12",
    kind: "release",
    title: "Features Lab, Stripe billing & unified Quality Score",
    summary:
      "Five brand-new AI workflows, end-to-end Stripe checkout, and a single Quality Score that reads the same on the dashboard and the analytics page.",
    items: [
      { area: "Lab",      text: "Blast Radius — paste a diff and see every file, test, and service it touches, ranked by risk." },
      { area: "Lab",      text: "Onboarding Simulator — generates a Day 1 / Week 1 / Month 1 plan from your actual codebase." },
      { area: "Lab",      text: "Tribal Knowledge Capture — preserves engineering context before a senior developer walks out." },
      { area: "Lab",      text: "Dependency Health Radar — flags packages where the maintainer's release cadence is slowing." },
      { area: "Lab",      text: "Codebase Time Machine — animated reconstruction of how any module evolved over the last 2 years." },
      { area: "Billing",  text: "Stripe subscription flow live for Free, Pro ($19/mo), Team ($49/mo), and Business (sales-led)." },
      { area: "Billing",  text: "/settings/billing page with plan limits, usage tracking, and the Stripe Customer Portal." },
      { area: "Status",   text: "/status page with live system health, 90-day uptime bars, and incident history." },
      { area: "Sales",    text: "/enterprise page for sales qualification with compliance badges and a contact form." },
      { area: "UI",       text: "Quality Score unified across the dashboard and analytics — single source of truth, plain-English labels (Excellent / Good / Fair / Needs work / Poor)." },
      { area: "Indexing", text: "Pre-filter binaries and lockfiles before fetch, batch Postgres commits every 10 files, pre-warm the embedding model for a faster first-file progress signal." },
      { area: "Workers",  text: "Concurrency bumped 2 → 4." },
      { area: "Auth",     text: "GitHub OAuth hides itself gracefully when unconfigured and returns an actionable 501 with setup instructions." },
      { area: "API",      text: "Network errors surface actionable messages instead of raw 'Failed to fetch'." },
    ],
  },
  {
    date: "2026-04-19",
    version: "v0.11",
    kind: "release",
    title: "Teams & organizations",
    summary: "Multi-tenant workspaces, invitations, and role-based access control land alongside the personal workspace flow.",
    items: [
      { area: "Orgs",  text: "Multi-tenant organizations — create shared workspaces for your team." },
      { area: "Orgs",  text: "Invite teammates by email; tokens are valid for 7 days with a one-click accept flow." },
      { area: "Auth",  text: "Role-based access control — owner, admin, member, with proper permission gates on every endpoint." },
      { area: "Orgs",  text: "Personal workspace auto-created on signup so solo users see no behaviour change." },
      { area: "UI",    text: "Organizations page with member management, role changes, and invitation tracking." },
      { area: "UI",    text: "'g then o' keyboard shortcut jumps to organizations." },
    ],
  },
  {
    date: "2026-04-18",
    version: "v0.10",
    kind: "release",
    title: "Auto re-index on push",
    summary: "GitHub webhooks keep every repo's analysis fresh — verified, deduplicated, and one-click to enable.",
    items: [
      { area: "Webhooks", text: "GitHub integration — push to the default branch and RepoInsight re-indexes automatically." },
      { area: "Security", text: "HMAC-SHA256 signature verification on every delivery rejects forged requests." },
      { area: "Webhooks", text: "Idempotency via X-GitHub-Delivery — duplicate deliveries skip re-processing." },
      { area: "UI",       text: "Per-repo webhook stats — see how many times auto-reindex has fired and when it last ran." },
      { area: "UI",       text: "One-click enable, secret rotation, and disable controls on the repo overview tab." },
    ],
  },
  {
    date: "2026-04-18",
    version: "v0.9",
    kind: "release",
    title: "Design system overhaul & command palette",
    items: [
      { area: "UI", text: "New command palette (⌘K / Ctrl+K) — jump to any repo, page, or action in 2 keystrokes." },
      { area: "UI", text: "Global keyboard shortcuts (g+d, g+c, g+a, g+s) for power users." },
      { area: "UI", text: "Responsive sidebar with mobile drawer." },
      { area: "UI", text: "Repo detail page tabs collapse to a dropdown on mobile." },
      { area: "UI", text: "Architecture diagram: zoom, pan, and fullscreen controls." },
      { area: "UI", text: "Onboarding tour for first-time users." },
    ],
  },
  {
    date: "2026-04-10",
    version: "v0.8",
    kind: "improvement",
    title: "Accessibility & polish",
    items: [
      { area: "A11y", text: "WCAG AA color contrast compliance across all text." },
      { area: "A11y", text: "Skip-to-content link, proper focus states, and reduced-motion support." },
      { area: "UI",   text: "Toast notifications replace browser alerts." },
      { area: "UI",   text: "Confirm dialogs replace browser confirms (with focus trap)." },
      { area: "UI",   text: "Skeleton loaders on dashboard, analytics, and repo detail." },
      { area: "UI",   text: "404 and error boundary pages." },
    ],
  },
  {
    date: "2026-04-02",
    version: "v0.7",
    kind: "release",
    title: "Security, onboarding & architecture reports",
    items: [
      { area: "Security",     text: "AI security scan finds hardcoded secrets, SQL injection, and XSS with CWE classifications." },
      { area: "Onboarding",   text: "'New developer in 30 minutes' generator per repo." },
      { area: "Architecture", text: "Auto-drawn Mermaid diagrams of your codebase." },
      { area: "Reports",      text: "Export full reports to Markdown (security + quality + tasks + docs)." },
      { area: "Storage",      text: "All AI artifacts now persist across sessions in the database." },
    ],
  },
  {
    date: "2026-03-22",
    version: "v0.6",
    kind: "improvement",
    title: "Better indexing & metadata",
    items: [
      { area: "Indexing", text: "File size limit raised from 500KB to 2MB." },
      { area: "Indexing", text: "Indexable extensions expanded from ~30 to 100+ (Kotlin, Elixir, Elm, Zig, Dart, and more)." },
      { area: "Indexing", text: "Indexable filenames added (Dockerfile, Makefile, README, .gitignore, etc.)." },
      { area: "GitHub",   text: "Stars, forks, and open-issue counts now refresh on every re-index." },
      { area: "Quality",  text: "Automatic quality score computed on indexing completion." },
    ],
  },
  {
    date: "2026-03-10",
    version: "v0.5",
    kind: "release",
    title: "Public repo support",
    items: [
      { area: "Repos", text: "Analyze any public GitHub repo without GitHub OAuth." },
      { area: "UI",    text: "Dashboard features one-click sample repos (Flask, Express, FastAPI)." },
      { area: "UI",    text: "Renamed 'Tech Debt' to 'Code Quality' for clarity." },
      { area: "UI",    text: "Priority and difficulty tooltips on task badges." },
    ],
  },
  {
    date: "2026-02-28",
    version: "v0.4",
    kind: "release",
    title: "Persistent caching & chat memory",
    items: [
      { area: "Chat",      text: "Remembers the last selected repo across sessions." },
      { area: "Analytics", text: "Remembers the last selected repo." },
      { area: "Storage",   text: "Generated docs, code quality, security, onboarding, and architecture results all persist." },
      { area: "UI",        text: "Blue-dot indicators on tabs surface unseen regenerated content." },
    ],
  },
  {
    date: "2026-02-15",
    version: "v0.3",
    kind: "release",
    title: "Task board & AI-generated tickets",
    items: [
      { area: "Tasks", text: "AI generates Jira-style engineering tasks from codebase analysis." },
      { area: "UI",    text: "Filter by status (Open / In Progress / Done)." },
      { area: "UI",    text: "Priority, difficulty, and task-type badges." },
      { area: "Tasks", text: "Suggested files per task." },
    ],
  },
  {
    date: "2026-02-01",
    version: "v0.2",
    kind: "release",
    title: "Anthropic Claude + local embeddings",
    items: [
      { area: "AI",        text: "Switched to Anthropic Claude for all AI features." },
      { area: "AI",        text: "Local sentence-transformers embeddings (no API costs for indexing)." },
      { area: "Chat",      text: "Answers now cite specific files and line ranges." },
      { area: "Analytics", text: "New page with commit frequency, contributor load, and language breakdown." },
    ],
  },
  {
    date: "2026-01-20",
    version: "v0.1",
    kind: "release",
    title: "First public beta",
    items: [
      { area: "Repos", text: "GitHub repo import and indexing pipeline." },
      { area: "Chat",  text: "Chat with your code." },
      { area: "Docs",  text: "Auto-generated documentation." },
      { area: "Auth",  text: "Email and GitHub OAuth authentication." },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function ChangelogPage() {
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [query, setQuery]   = useState("");

  const filtered = useMemo(() => {
    return ENTRIES.filter(e => {
      if (filter !== "all" && e.kind !== filter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const matchesEntry =
          e.title.toLowerCase().includes(q) ||
          e.version.toLowerCase().includes(q) ||
          (e.summary || "").toLowerCase().includes(q) ||
          e.items.some(i => i.text.toLowerCase().includes(q) || (i.area || "").toLowerCase().includes(q));
        if (!matchesEntry) return false;
      }
      return true;
    });
  }, [filter, query]);

  const counts = useMemo(() => ({
    all:         ENTRIES.length,
    release:     ENTRIES.filter(e => e.kind === "release").length,
    improvement: ENTRIES.filter(e => e.kind === "improvement").length,
    fix:         ENTRIES.filter(e => e.kind === "fix").length,
  }), []);

  return (
    <div className="relative min-h-screen flex flex-col bg-surface overflow-x-hidden">
      {/* Soft ambient glow — keeps the page feeling alive without being noisy */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] pointer-events-none z-0"
        style={{ background: "radial-gradient(ellipse at top, rgba(124,107,255,0.10), transparent 60%)" }}
        aria-hidden="true" />

      {/* Nav */}
      <MarketingNav />

      <main id="main-content" className="relative z-10 flex-1 w-full">
        {/* Hero */}
        <section className="max-w-4xl mx-auto px-6 pt-16 pb-10">
          <p className="eyebrow mb-5">
            <span className="status-dot" aria-hidden="true" />
            Changelog
          </p>
          <h1 className="text-display-2 text-balance">
            What&apos;s new in <span className="text-gradient">RepoInsight</span>
          </h1>
          <p className="text-text-secondary text-lg mt-5 text-pretty max-w-2xl">
            Every release we ship — new features, improvements, and fixes — in chronological order. Newest on top.
          </p>

          {/* Subscribe / source links */}
          <div className="mt-6 flex flex-wrap gap-2">
            <a href="https://github.com/anthropics/repoinsight" target="_blank" rel="noopener noreferrer"
              className="btn-secondary text-xs">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.38.6.11.82-.25.82-.57v-2C4 22 3.5 19.5 3.5 19.5 3 18.5 2 18 2 18c-1-.73.08-.72.08-.72 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.3.76-1.6C5.62 17.6 2.66 16.6 2.66 12c0-1.3.47-2.39 1.24-3.23C3.78 8.47 3.36 7.24 4 5.6c0 0 1.01-.32 3.3 1.23A11.54 11.54 0 0112 6.34a11.54 11.54 0 014.7.49c2.29-1.55 3.29-1.23 3.29-1.23.65 1.64.24 2.87.12 3.17.77.84 1.23 1.93 1.23 3.23 0 4.62-2.97 5.6-5.78 5.9.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
              View on GitHub
            </a>
            <a href="/changelog/feed.xml" className="btn-secondary text-xs">
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3 4a1 1 0 011-1c7.18 0 13 5.82 13 13a1 1 0 11-2 0c0-6.08-4.92-11-11-11a1 1 0 01-1-1zm0 5a1 1 0 011-1 8 8 0 018 8 1 1 0 11-2 0 6 6 0 00-6-6 1 1 0 01-1-1zm2 7a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
              RSS feed
            </a>
          </div>
        </section>

        {/* Sticky filter / search bar */}
        <div className="sticky top-[57px] z-20 bg-surface/85 backdrop-blur-xl border-y border-white/5">
          <div className="max-w-4xl mx-auto px-6 py-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 flex-wrap">
              <FilterChip label="All"          active={filter === "all"}         count={counts.all}         onClick={() => setFilter("all")} />
              <FilterChip label="Releases"     active={filter === "release"}     count={counts.release}     onClick={() => setFilter("release")}     tone="blue" />
              <FilterChip label="Improvements" active={filter === "improvement"} count={counts.improvement} onClick={() => setFilter("improvement")} tone="green" />
              <FilterChip label="Fixes"        active={filter === "fix"}         count={counts.fix}         onClick={() => setFilter("fix")}         tone="yellow" />
            </div>
            <div className="ml-auto relative flex-1 min-w-[180px] max-w-xs">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="9" cy="9" r="6" />
                <path d="M17 17l-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                aria-label="Search changelog"
                placeholder="Search the changelog…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full bg-surface-overlay border border-surface-border rounded-md pl-8 pr-3 py-1.5 text-sm placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>
        </div>

        {/* Entries */}
        <section className="max-w-4xl mx-auto px-6 py-12">
          {filtered.length === 0 ? (
            <div className="card-glass p-12 text-center">
              <p className="text-text-secondary">No entries match those filters.</p>
              <button onClick={() => { setFilter("all"); setQuery(""); }} className="btn-secondary text-sm mt-4">Clear filters</button>
            </div>
          ) : (
            <ol className="relative space-y-12">
              {/* Continuous timeline rail */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-accent/40 via-violet/20 to-transparent pointer-events-none" aria-hidden="true" />
              {filtered.map(entry => (
                <li key={entry.version} id={entry.version} className="relative pl-8 scroll-mt-32">
                  {/* Timeline dot */}
                  <div className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full bg-surface ring-2 ring-accent/40 flex items-center justify-center" aria-hidden="true">
                    <div className="w-2 h-2 rounded-full bg-gradient-to-br from-violet to-accent" />
                  </div>

                  {/* Header */}
                  <header className="space-y-2 mb-4">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <a href={`#${entry.version}`} className="font-mono text-sm text-accent hover:underline underline-offset-4">
                        {entry.version}
                      </a>
                      <KindBadge kind={entry.kind} />
                      <time dateTime={entry.date} className="text-xs text-text-muted font-mono ml-auto">
                        {formatDate(entry.date)}
                      </time>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-semibold text-balance leading-tight">{entry.title}</h2>
                    {entry.summary && (
                      <p className="text-text-secondary text-sm leading-relaxed text-pretty">{entry.summary}</p>
                    )}
                  </header>

                  {/* Items */}
                  <div className="card-glass p-5">
                    <ul className="space-y-2.5">
                      {entry.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm">
                          {item.area && (
                            <span className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] text-text-muted border border-white/5 min-w-[60px] justify-center">
                              {item.area}
                            </span>
                          )}
                          <span className="leading-relaxed text-text-secondary text-pretty flex-1">{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* CTA */}
          <div className="card-glass p-8 mt-16 text-center space-y-3 relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-accent/15 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
            <div className="relative">
              <h2 className="text-xl font-semibold">Stay in the loop</h2>
              <p className="text-text-secondary text-sm mt-2 max-w-md mx-auto">
                We ship something every couple of weeks. Follow along on GitHub or kick the tires for free.
              </p>
              <div className="flex gap-2 justify-center flex-wrap mt-5">
                <a
                  href="https://github.com/anthropics/repoinsight"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-sm"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.38.6.11.82-.25.82-.57v-2C4 22 3.5 19.5 3.5 19.5 3 18.5 2 18 2 18c-1-.73.08-.72.08-.72 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.3.76-1.6C5.62 17.6 2.66 16.6 2.66 12c0-1.3.47-2.39 1.24-3.23C3.78 8.47 3.36 7.24 4 5.6c0 0 1.01-.32 3.3 1.23A11.54 11.54 0 0112 6.34a11.54 11.54 0 014.7.49c2.29-1.55 3.29-1.23 3.29-1.23.65 1.64.24 2.87.12 3.17.77.84 1.23 1.93 1.23 3.23 0 4.62-2.97 5.6-5.78 5.9.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
                  Star on GitHub
                </a>
                <Link href="/auth?mode=register" className="btn-primary text-sm">
                  Create an Account for Free
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter compact />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Small components
   ──────────────────────────────────────────────────────────────────── */

function FilterChip({
  label, active, count, onClick, tone,
}: { label: string; active: boolean; count: number; onClick: () => void; tone?: "blue" | "green" | "yellow" }) {
  const dot = tone === "blue"  ? "bg-accent"
            : tone === "green" ? "bg-emerald"
            : tone === "yellow"? "bg-amber"
            : "bg-text-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
        ${active
          ? "bg-accent/15 text-accent border border-accent/30"
          : "bg-surface-overlay/60 text-text-secondary border border-surface-border hover:bg-surface-overlay"}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
      <span className={`text-[10px] font-mono ${active ? "text-accent/80" : "text-text-muted"}`}>{count}</span>
    </button>
  );
}

function KindBadge({ kind }: { kind: Kind }) {
  const map: Record<Kind, { cls: string; label: string }> = {
    release:     { cls: "badge-blue",   label: "Release" },
    improvement: { cls: "badge-green",  label: "Improvement" },
    fix:         { cls: "badge-yellow", label: "Fix" },
  };
  const { cls, label } = map[kind];
  return <span className={cls}>{label}</span>;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
