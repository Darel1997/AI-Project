"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";

export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="relative min-h-screen flex flex-col bg-surface overflow-x-hidden">
      {/* Ambient aurora — layered animated gradient mesh */}
      <AmbientBackground />

      <MarketingNav />

      <main id="main-content" className="relative z-10 flex-1">
        {/* ── HERO ───────────────────────────────────────── */}
        <section className="relative max-w-6xl mx-auto px-6 pt-20 pb-28 text-center" aria-labelledby="hero-heading">
          <div className="eyebrow mb-8 animate-fade-in">
            <span className="status-dot" aria-hidden="true" />
            New — Five workflows just landed in the Features Lab
          </div>

          <h1 id="hero-heading" className="text-display-1 mx-auto max-w-5xl animate-slide-up">
            Ship code faster with an AI that{" "}
            <span className="text-gradient">knows your codebase</span>
          </h1>

          <p className="text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto mt-7 leading-relaxed animate-slide-up" style={{ animationDelay: "80ms" }}>
            Connect any GitHub repo and get grounded documentation, security scans, onboarding guides, architecture maps, and a chat that cites every claim — in under a minute.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-10 animate-slide-up" style={{ animationDelay: "160ms" }}>
            {!user && (
              <Link href="/auth?mode=register" className="btn-glow text-base px-7 py-3">
                Create an Account for Free
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            )}
            <Link href="#demo" className="btn-secondary text-base px-7 py-3">
              See it in action
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap justify-center items-center gap-x-8 gap-y-3 text-xs text-text-muted animate-fade-in-slow">
            <TrustItem>No credit card required</TrustItem>
            <TrustItem>Free for public repositories</TrustItem>
            <TrustItem>SOC 2 compliance roadmap</TrustItem>
            <TrustItem>Your code stays on your servers</TrustItem>
          </div>

          {/* Product preview — glass card with animated cursor */}
          <div className="mt-20 animate-fade-in-slow" style={{ animationDelay: "320ms" }}>
            <ProductPreview />
          </div>
        </section>

        {/* ── CAPABILITIES BAR ───────────────────────────────────
             Verifiable claims only. No invented uptime numbers, no
             "10× faster" — every value below maps to something the
             code actually does. */}
        <section className="relative py-16 max-w-6xl mx-auto px-6" aria-labelledby="capabilities-heading">
          <h2 id="capabilities-heading" className="sr-only">Why teams pick RepoInsight</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 rounded-2xl overflow-hidden card-glass">
            <CapabilityTile
              value="21"
              label="AI-powered features"
              detail="Across chat, audits, onboarding, migrations & more"
            />
            <CapabilityTile
              value="< 60s"
              label="Time to first index"
              detail="On a typical mid-sized repo"
            />
            <CapabilityTile
              value="100+"
              label="Languages indexed"
              detail="Tree-sitter where available, fallback for the rest"
            />
            <CapabilityTile
              value="Every"
              label="Answer is cited"
              detail="File paths and line ranges, never hand-waved"
            />
          </div>
        </section>

        {/* ── COMPLIANCE ROADMAP — honest about what's done and what isn't ─────────── */}
        <section className="relative max-w-6xl mx-auto px-6 pb-8" aria-label="Compliance roadmap">
          <div className="card-glass py-5 px-6 flex items-center justify-center gap-x-8 gap-y-3 flex-wrap text-xs">
            <TrustBadge label="SOC 2 Type II" note="Roadmap" />
            <Divider />
            <TrustBadge label="GDPR" note="Roadmap" />
            <Divider />
            <TrustBadge label="CCPA" note="Roadmap" />
            <Divider />
            <TrustBadge label="ISO 27001" note="Roadmap" />
            <Divider />
            <Link href="/security" className="text-text-muted hover:text-text-primary transition-colors">
              Security details →
            </Link>
          </div>
        </section>

        {/* ── DEMO / USE CASES ──────────────────────────── */}
        <section id="demo" className="relative py-24 max-w-6xl mx-auto px-6" aria-labelledby="demo-heading">
          <div className="text-center mb-16">
            <p className="eyebrow mb-4">How it works</p>
            <h2 id="demo-heading" className="text-display-2 text-balance max-w-3xl mx-auto">
              Everything you need to <span className="text-gradient-accent">master a codebase</span>
            </h2>
            <p className="text-text-secondary text-lg mt-5 max-w-2xl mx-auto">
              Three pillars, one platform. Each grounded in your actual source, each citing its work.
            </p>
          </div>

          <div className="space-y-20">
            <DemoRow
              kicker="01 · Chat"
              title="Ask anything. Get cited answers."
              desc="No more grepping for hours. Ask plain English questions — 'Where does auth live?' 'Why are we doing X in file Y?' — and get answers with clickable citations to the exact files and line ranges."
              bullets={[
                "Every claim links back to source",
                "Understands code across files",
                "Works on any language",
              ]}
              demo={<ChatDemo />}
              reversed={false}
            />
            <DemoRow
              kicker="02 · Security"
              title="A security scanner that catches real issues."
              desc="Not noise. Not false positives. Structured findings classified by CWE with concrete remediation steps — ready to paste into your security review."
              bullets={[
                "CWE-classified findings",
                "Severity + remediation per issue",
                "Export Markdown reports",
              ]}
              demo={<SecurityDemo />}
              reversed={true}
            />
            <DemoRow
              kicker="03 · Architecture"
              title="See the system, not just files."
              desc="Auto-generated Mermaid diagrams of your architecture. Onboarding guides written from the actual code. Everything a new engineer needs on day one."
              bullets={[
                "Interactive architecture maps",
                "30-minute onboarding docs per repo",
                "Re-generates on every push",
              ]}
              demo={<ArchitectureDemo />}
              reversed={false}
            />
          </div>
        </section>

        {/* ── UNIQUE FEATURES — the differentiation story ────── */}
        <section className="relative py-24 max-w-6xl mx-auto px-6" aria-labelledby="unique-heading">
          <div className="text-center mb-16">
            <p className="eyebrow mb-4">
              <span className="status-dot" aria-hidden="true" />
              Unlike anything else
            </p>
            <h2 id="unique-heading" className="text-display-2 text-balance max-w-3xl mx-auto">
              Five workflows <span className="text-gradient">no other tool has</span>
            </h2>
            <p className="text-text-secondary text-lg mt-5 max-w-2xl mx-auto">
              Cursor ships autocomplete. Sourcegraph ships search. Copilot ships suggestions. We ship the workflows that actually solve engineering&apos;s hardest problems.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <UniqueCard
              kicker="01 · Blast Radius"
              title="Predict ripple effects before you merge"
              desc="Paste a diff — see every file, test, and service affected, ranked by risk. Recommended reviewers auto-selected from git blame. Coverage gaps flagged. Like `terraform plan` for code."
              color="accent"
              accent="from-accent/30 to-violet/30"
              ctaLabel="Trace a sample diff"
            />
            <UniqueCard
              kicker="02 · Onboarding Simulator"
              title="Day 1 / Week 1 / Month 1 plans, generated"
              desc="New hire Monday? We build a role-calibrated curriculum from your actual codebase. Real bugs as first-PR targets. Real owners as 'people to meet'. Real gotchas surfaced from git history."
              color="violet"
              accent="from-violet/30 to-cyan/30"
              ctaLabel="Build a starter curriculum"
            />
            <UniqueCard
              kicker="03 · Tribal Knowledge Capture"
              title="Preserve engineering context before it walks out"
              desc="Senior engineer leaving? Auto-generate a brain dump of what only they knew: areas owned, decisions made, conventions introduced. The first product built for engineering succession."
              color="cyan"
              accent="from-cyan/30 to-emerald/30"
              ctaLabel="Capture a knowledge dump"
            />
            <UniqueCard
              kicker="04 · Dependency Health Radar"
              title="Tech debt radar, not just CVE alerts"
              desc="Lodash is fine. But is its maintainer still shipping? Is the release cadence slowing? Are there 3 healthier alternatives that fit your usage? We surface it proactively, weekly."
              color="amber"
              accent="from-amber/30 to-rose/30"
              ctaLabel="Audit your dependencies"
            />
            <UniqueCard
              kicker="05 · Codebase Time Machine"
              title="See how any module evolved, visualized"
              desc="Pick /src/auth. We reconstruct 2 years of its story: file count over time, contributor shifts, major refactors, incidents. Animated. Lessons from history applied to today."
              color="emerald"
              accent="from-emerald/30 to-accent/30"
              ctaLabel="Replay a module's history"
              wide
            />
          </div>
        </section>

        {/* ── FEATURES GRID ─────────────────────────────── */}
        <section id="features" className="relative py-24 max-w-6xl mx-auto px-6" aria-labelledby="features-heading">
          <div className="text-center mb-16">
            <p className="eyebrow mb-4">Full feature set</p>
            <h2 id="features-heading" className="text-display-2 text-balance">A toolbelt, not a chatbot.</h2>
            <p className="text-text-secondary text-lg mt-5 max-w-2xl mx-auto">
              Every feature below is grounded in your indexed source. Each one replaces an internal tool, a wiki page, or a one-off script that someone wrote and then forgot to maintain.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} feature={f} index={i} />
            ))}
          </div>
        </section>

        {/* ── FINAL CTA ─────────────────────────────────── */}
        {!user && (
          <section className="relative py-24 max-w-4xl mx-auto px-6" aria-labelledby="cta-heading">
            <div className="card-glass p-12 sm:p-16 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-aurora opacity-60 pointer-events-none animate-aurora" aria-hidden="true" />
              <div className="relative">
                <h2 id="cta-heading" className="text-display-2 text-balance mb-4">
                  Start understanding your code today
                </h2>
                <p className="text-text-secondary text-lg max-w-xl mx-auto mb-8">
                  Free to try. No credit card. Your first repository is indexed in under a minute.
                </p>
                <Link href="/auth?mode=register" className="btn-glow text-base px-7 py-3">
                  Create an Account for Free
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>
            </div>
          </section>
        )}
      </main>

      <MarketingFooter />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   COMPONENTS
   ══════════════════════════════════════════════════════════════════════ */

function AmbientBackground() {
  return (
    <>
      {/* Grid pattern — faint */}
      <div className="fixed inset-0 bg-grid-pattern bg-[size:80px_80px] opacity-30 pointer-events-none z-0" aria-hidden="true" />
      {/* Aurora blobs — slow floating gradients */}
      <div className="fixed top-0 left-0 w-[800px] h-[800px] rounded-full pointer-events-none z-0 animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(124,107,255,0.18), transparent 60%)", filter: "blur(80px)" }}
        aria-hidden="true" />
      <div className="fixed top-[20%] right-0 w-[600px] h-[600px] rounded-full pointer-events-none z-0 animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.12), transparent 60%)", filter: "blur(80px)", animationDelay: "3s" }}
        aria-hidden="true" />
      <div className="fixed bottom-0 left-[30%] w-[700px] h-[700px] rounded-full pointer-events-none z-0 animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(183,148,244,0.15), transparent 60%)", filter: "blur(80px)", animationDelay: "6s" }}
        aria-hidden="true" />
    </>
  );
}

function TrustItem({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg className="w-3.5 h-3.5 text-emerald" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </span>
  );
}

function WordMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-lg font-bold tracking-tight text-text-secondary hover:text-text-primary transition-colors">
      {children}
    </span>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="space-y-2">
      <div className="text-4xl sm:text-5xl font-bold text-gradient-accent tracking-tight">{value}</div>
      <div className="text-sm text-text-muted">{label}</div>
    </div>
  );
}

/** Capability tile — used in the homepage capabilities bar. Three tiers of
 * information: a hero number, a short label, and a longer plain-English
 * explanation so the claim feels concrete instead of marketing-y. */
function CapabilityTile({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <div className="bg-surface/60 px-6 py-7 sm:py-8 text-center group hover:bg-surface/40 transition-colors">
      <div className="text-3xl sm:text-4xl font-bold text-gradient-accent tracking-tight tabular-nums">{value}</div>
      <div className="text-sm font-medium text-text-primary mt-2">{label}</div>
      <div className="text-xs text-text-muted mt-1.5 leading-relaxed">{detail}</div>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="relative max-w-5xl mx-auto group">
      {/* Glow beneath */}
      <div className="absolute inset-0 bg-aurora opacity-70 blur-3xl -z-10" aria-hidden="true" />
      <div className="card-glass p-2 shadow-card-elevated">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-rose/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald/70" />
          </div>
          <div className="flex-1 mx-4 bg-surface-sunken rounded-md px-3 py-1 text-xs text-text-muted font-mono flex items-center gap-2">
            <svg className="w-3 h-3 text-emerald" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 8V6a4 4 0 018 0v2m-6 0h8a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            app.repoinsight.ai/chat
          </div>
        </div>
        {/* Product content */}
        <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 text-left">
          <div className="hidden md:block space-y-1">
            <PreviewNavItem active>Chat</PreviewNavItem>
            <PreviewNavItem>Security</PreviewNavItem>
            <PreviewNavItem>Architecture</PreviewNavItem>
            <PreviewNavItem>Onboarding</PreviewNavItem>
            <PreviewNavItem>Tasks</PreviewNavItem>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3 animate-fade-in-slow">
              <div className="w-7 h-7 rounded-full bg-surface-overlay flex items-center justify-center shrink-0 text-xs text-text-muted">You</div>
              <div className="flex-1 bg-surface-overlay rounded-xl rounded-tl-sm px-4 py-2.5 text-sm">
                Where does authentication live in our API?
              </div>
            </div>
            <div className="flex items-start gap-3 animate-fade-in-slow" style={{ animationDelay: "600ms" }}>
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet to-accent flex items-center justify-center shrink-0 text-[10px] font-bold text-white">AI</div>
              <div className="flex-1 bg-accent/5 border border-accent/20 rounded-xl rounded-tl-sm px-4 py-3 text-sm space-y-2">
                <p className="leading-relaxed text-text-primary">
                  Auth is handled in <code className="text-violet font-mono text-xs bg-violet/10 px-1 py-0.5 rounded">src/auth/oauth.py</code> via OAuth 2.0. The <code className="text-violet font-mono text-xs bg-violet/10 px-1 py-0.5 rounded">verify_token()</code> middleware runs on every protected route.
                </p>
                <div className="pt-2 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Sources</p>
                  {[
                    { file: "src/auth/oauth.py:42-89", score: 98 },
                    { file: "src/middleware/verify.py:12-34", score: 91 },
                    { file: "src/api/routes.py:5-27", score: 84 },
                  ].map(s => (
                    <div key={s.file} className="text-xs font-mono text-text-secondary flex items-center gap-2 bg-surface-sunken/50 px-2 py-1 rounded">
                      <span className="w-1 h-1 rounded-full bg-accent" />
                      <span className="truncate flex-1">{s.file}</span>
                      <span className="text-[10px] text-text-muted">{s.score}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewNavItem({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div className={`px-3 py-1.5 rounded-md text-sm transition-colors ${active ? "bg-accent/15 text-accent" : "text-text-muted"}`}>
      {children}
    </div>
  );
}

interface DemoRowProps {
  kicker: string;
  title: string;
  desc: string;
  bullets: string[];
  demo: React.ReactNode;
  reversed: boolean;
}

function DemoRow({ kicker, title, desc, bullets, demo, reversed }: DemoRowProps) {
  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center ${reversed ? "lg:[&>*:first-child]:order-2" : ""}`}>
      <div className="space-y-5">
        <p className="section-heading text-accent">{kicker}</p>
        <h3 className="text-display-3 text-balance">{title}</h3>
        <p className="text-text-secondary text-lg leading-relaxed">{desc}</p>
        <ul className="space-y-2 pt-2">
          {bullets.map(b => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-text-secondary">
              <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>{demo}</div>
    </div>
  );
}

function ChatDemo() {
  return (
    <div className="card-glass p-5 space-y-3 shadow-card-elevated">
      <div className="flex items-start gap-2.5">
        <div className="w-6 h-6 rounded-full bg-surface-overlay shrink-0" />
        <div className="bg-surface-overlay rounded-xl rounded-tl-sm px-3 py-2 text-sm">
          How is rate limiting configured?
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet to-accent shrink-0 flex items-center justify-center text-[9px] font-bold text-white">AI</div>
        <div className="flex-1 space-y-2">
          <div className="bg-accent/5 border border-accent/20 rounded-xl rounded-tl-sm px-3 py-2 text-sm">
            Rate limiting uses the <code className="text-violet text-xs">slowapi</code> decorator with 100 req/min limits…
          </div>
          <div className="text-xs font-mono text-text-muted space-y-1">
            <div>├ src/api/limits.py:8</div>
            <div>└ src/main.py:42</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityDemo() {
  return (
    <div className="card-glass p-5 space-y-3 shadow-card-elevated">
      <div className="flex items-center gap-2 pb-2 border-b border-white/5">
        <svg className="w-4 h-4 text-accent" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M10 18s6-3 6-8V4l-6-2-6 2v6c0 5 6 8 6 8z" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold">Security scan · 3 findings</span>
      </div>
      <SecurityFinding severity="critical" cwe="CWE-798" file="src/auth/oauth.py" issue="Hardcoded OAuth secret" />
      <SecurityFinding severity="high" cwe="CWE-89" file="src/api/queries.py" issue="SQL string concatenation" />
      <SecurityFinding severity="medium" cwe="CWE-117" file="src/logger.py" issue="Unsanitized log input" />
    </div>
  );
}

function SecurityFinding({ severity, cwe, file, issue }: { severity: "critical" | "high" | "medium"; cwe: string; file: string; issue: string }) {
  const colors = {
    critical: "bg-danger-muted text-danger",
    high: "bg-warning-muted text-warning",
    medium: "bg-accent-subtle text-accent",
  };
  return (
    <div className="flex items-center gap-3 py-1.5 text-xs">
      <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider text-[10px] ${colors[severity]}`}>{severity}</span>
      <span className="font-mono text-text-muted text-[10px]">{cwe}</span>
      <span className="font-medium truncate flex-1">{issue}</span>
      <code className="text-text-muted font-mono text-[10px] hidden sm:inline">{file}</code>
    </div>
  );
}

function ArchitectureDemo() {
  return (
    <div className="card-glass p-5 shadow-card-elevated">
      <div className="flex items-center gap-2 pb-3 border-b border-white/5 mb-3">
        <svg className="w-4 h-4 text-accent" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="2" y="2" width="6" height="6" rx="0.5" />
          <rect x="12" y="2" width="6" height="6" rx="0.5" />
          <rect x="12" y="12" width="6" height="6" rx="0.5" />
          <rect x="2" y="12" width="6" height="6" rx="0.5" />
        </svg>
        <span className="text-sm font-semibold">System architecture</span>
      </div>
      <svg viewBox="0 0 320 180" className="w-full" aria-hidden="true">
        {/* Connecting lines */}
        <line x1="60" y1="40" x2="160" y2="40" stroke="rgba(124,107,255,0.4)" strokeWidth="1.5" strokeDasharray="3 3" />
        <line x1="160" y1="40" x2="260" y2="40" stroke="rgba(124,107,255,0.4)" strokeWidth="1.5" strokeDasharray="3 3" />
        <line x1="160" y1="55" x2="160" y2="125" stroke="rgba(124,107,255,0.4)" strokeWidth="1.5" strokeDasharray="3 3" />
        <line x1="60" y1="140" x2="160" y2="140" stroke="rgba(124,107,255,0.4)" strokeWidth="1.5" strokeDasharray="3 3" />
        <line x1="160" y1="140" x2="260" y2="140" stroke="rgba(124,107,255,0.4)" strokeWidth="1.5" strokeDasharray="3 3" />
        {/* Nodes */}
        {[
          { x: 20, y: 25, label: "Client", fill: "rgba(124,107,255,0.15)", stroke: "rgba(124,107,255,0.5)" },
          { x: 120, y: 25, label: "API", fill: "rgba(34,211,238,0.15)", stroke: "rgba(34,211,238,0.5)" },
          { x: 220, y: 25, label: "Auth", fill: "rgba(183,148,244,0.15)", stroke: "rgba(183,148,244,0.5)" },
          { x: 120, y: 125, label: "Worker", fill: "rgba(52,211,153,0.15)", stroke: "rgba(52,211,153,0.5)" },
          { x: 20, y: 125, label: "Cache", fill: "rgba(251,191,36,0.15)", stroke: "rgba(251,191,36,0.5)" },
          { x: 220, y: 125, label: "DB", fill: "rgba(251,113,133,0.15)", stroke: "rgba(251,113,133,0.5)" },
        ].map(n => (
          <g key={n.label}>
            <rect x={n.x} y={n.y} width="80" height="30" rx="4" fill={n.fill} stroke={n.stroke} strokeWidth="1" />
            <text x={n.x + 40} y={n.y + 19} textAnchor="middle" fill="rgb(245,246,249)" fontSize="11" fontFamily="Inter">{n.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

interface Feature {
  title: string;
  desc: string;
  Icon: () => JSX.Element;
  accent?: string;
  /** Original CTA label, written specifically for what this feature does. */
  cta: string;
  /** Where the card links to. Most go to register; mature pages have their own destinations. */
  ctaHref?: string;
}

const FEATURES: Feature[] = [
  {
    title: "Chat with your code",
    desc: "Ask plain English questions. Every answer cites the exact files and line numbers.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>,
    accent: "accent",
    cta: "Ask the demo a question",
  },
  {
    title: "Auto-generated docs",
    desc: "Architecture overviews and module docs from the source of truth — the code itself.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
    accent: "cyan",
    cta: "Generate docs from a repo",
  },
  {
    title: "Security scanner",
    desc: "CWE-classified findings with remediation. Hardcoded secrets, SQLi, XSS, auth flaws.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
    accent: "rose",
    cta: "Run a sample security scan",
  },
  {
    title: "Architecture diagrams",
    desc: "Auto-drawn Mermaid diagrams of your system. See the big picture in one glance.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M10 6.5h4M10 17.5h4M6.5 10v4M17.5 10v4" /></svg>,
    accent: "violet",
    cta: "Visualize your system",
  },
  {
    title: "Onboarding guides",
    desc: "'New developer in 30 minutes' — setup, entry points, key abstractions, gotchas.",
    // Compass-style icon — distinct from the people icon used by Team workspaces, which
    // previously shared the same SVG and made the grid look like a duplicate.
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>,
    accent: "emerald",
    cta: "Build a new-hire guide",
  },
  {
    title: "Code quality audits",
    desc: "Code smells, complexity hotspots, missing tests. Each finding ships with a concrete fix.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>,
    accent: "amber",
    cta: "Audit a repository",
  },
  {
    title: "Task generation",
    desc: "AI-generated Jira-style tickets with priority, difficulty, and suggested files.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>,
    accent: "accent",
    cta: "Draft your first sprint",
  },
  {
    title: "Auto re-index on push",
    desc: "GitHub webhooks keep your analysis fresh. HMAC-verified, idempotent, zero setup.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>,
    accent: "cyan",
    cta: "Wire up a webhook",
  },
  {
    title: "Team workspaces",
    desc: "Invite teammates, share repos, manage roles. SSO, audit log, RBAC on Team plan.",
    Icon: () => <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>,
    accent: "violet",
    cta: "Spin up a workspace",
    ctaHref: "/pricing",
  },
];

function TrustBadge({ label, note }: { label: string; note?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-text-secondary whitespace-nowrap">
      <svg className="w-3.5 h-3.5 text-emerald shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-medium text-text-primary">{label}</span>
      {note && <span className="text-[10px] text-text-muted uppercase tracking-wider">{note}</span>}
    </span>
  );
}

function Divider() {
  return <span className="hidden sm:inline-block w-px h-3 bg-white/10" aria-hidden="true" />;
}

function UniqueCard({ kicker, title, desc, color, accent, ctaLabel, wide = false }: {
  kicker: string; title: string; desc: string; color: string; accent: string;
  /** Card-specific call-to-action. Each card writes its own label so the row of
   * cards reads as five distinct invitations rather than a wall of "Try it." */
  ctaLabel: string;
  wide?: boolean;
}) {
  return (
    <article className={`card-glass p-7 group relative overflow-hidden ${wide ? "md:col-span-2" : ""}`}>
      <div className={`absolute -top-20 -right-20 w-48 h-48 rounded-full blur-3xl pointer-events-none bg-gradient-to-br ${accent} opacity-50 group-hover:opacity-100 transition-opacity`} aria-hidden="true" />
      <div className="relative space-y-3">
        <p className={`section-heading text-${color}`}>{kicker}</p>
        <h3 className="text-xl font-bold text-balance">{title}</h3>
        <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
        {/* CTA — every UniqueCard ships with its own action verb, not a generic "Learn more". */}
        <Link
          href="/auth?mode=register"
          className={`inline-flex items-center gap-1.5 text-sm font-medium text-${color} hover:gap-2 transition-all pt-2`}
        >
          {ctaLabel}
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </article>
  );
}

function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const accentMap: Record<string, string> = {
    accent:  "text-accent bg-accent-subtle",
    cyan:    "text-cyan bg-cyan-subtle",
    violet:  "text-violet bg-violet-subtle",
    emerald: "text-emerald bg-emerald-subtle",
    amber:   "text-amber bg-amber-subtle",
    rose:    "text-rose bg-rose-subtle",
  };
  const ctaTextMap: Record<string, string> = {
    accent:  "text-accent",
    cyan:    "text-cyan",
    violet:  "text-violet",
    emerald: "text-emerald",
    amber:   "text-amber",
    rose:    "text-rose",
  };
  const accentClass = accentMap[feature.accent || "accent"];
  const ctaTextClass = ctaTextMap[feature.accent || "accent"];
  return (
    <Link
      href={feature.ctaHref || "/auth?mode=register"}
      className="card-hover p-6 group animate-fade-in flex flex-col"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className={`inline-flex w-10 h-10 items-center justify-center rounded-lg ${accentClass} mb-4 group-hover:scale-110 transition-transform`}>
        <feature.Icon />
      </div>
      <h3 className="font-semibold text-base">{feature.title}</h3>
      <p className="text-sm text-text-secondary mt-2 leading-relaxed flex-1">{feature.desc}</p>
      {/* Per-feature CTA — each one is a distinct verb tied to what the feature does. */}
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium mt-4 ${ctaTextClass} group-hover:gap-2 transition-all`}>
        {feature.cta}
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  );
}
