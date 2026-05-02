"use client";

/**
 * FindingCard — the primary "what to fix" UI element used by the Code Quality
 * and Security tabs on the repo detail page.
 *
 * Design intent: developers should be able to glance at a finding and know
 *   1. WHERE — exact file (and line, if known)
 *   2. WHAT — the issue, plus a one-line classification (CWE / category)
 *   3. WHY — severity + a plain-English explanation of impact
 *   4. HOW — concrete remediation, with a copy-to-clipboard button
 *
 * Each finding can be expanded for the full remediation text and collapsed
 * back down to a one-line summary so a long list is still scannable.
 */

import { useState } from "react";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface FindingCardProps {
  /** File path inside the repo, e.g. "src/auth/oauth.py" */
  filePath: string;
  /** Optional line range or "L42-L89" hint */
  lineHint?: string;
  /** Severity bucket — drives color and icon */
  severity: Severity;
  /** A 2-6 word category (e.g. "Hardcoded secret", "Long function") */
  category: string;
  /** Optional standardized classification (e.g. "CWE-798") */
  classification?: string;
  /** A single-sentence summary of the issue */
  title: string;
  /** Longer plain-English description of the issue and its impact */
  description?: string;
  /** Actionable remediation guidance — what the developer should do */
  remediation: string;
  /** Optional ordinal index, used by the parent for "1 of 12" labeling */
  index?: number;
  /** Total count, paired with `index` */
  total?: number;
  /** When provided, renders a "Open in editor" link (vscode://) and an "Open on GitHub" link */
  githubBlobUrl?: string;
}

const SEVERITY_META: Record<Severity, {
  label: string;
  bar: string;       // tailwind bg color for the left bar
  pill: string;      // pill background classes
  text: string;      // text color for emphasis
  rank: number;      // for sorting — higher = worse
}> = {
  critical: { label: "Critical", bar: "bg-rose",    pill: "bg-rose/15 text-rose border-rose/30",       text: "text-rose",    rank: 4 },
  high:     { label: "High",     bar: "bg-rose/70", pill: "bg-rose/10 text-rose border-rose/20",       text: "text-rose",    rank: 3 },
  medium:   { label: "Medium",   bar: "bg-amber",   pill: "bg-amber/15 text-amber border-amber/30",    text: "text-amber",   rank: 2 },
  low:      { label: "Low",      bar: "bg-emerald", pill: "bg-emerald/15 text-emerald border-emerald/30", text: "text-emerald", rank: 1 },
  info:     { label: "Info",     bar: "bg-accent",  pill: "bg-accent/15 text-accent border-accent/30", text: "text-accent",  rank: 0 },
};

export function severityRank(s: Severity): number {
  return SEVERITY_META[s]?.rank ?? 0;
}

export function FindingCard({
  filePath,
  lineHint,
  severity,
  category,
  classification,
  title,
  description,
  remediation,
  index,
  total,
  githubBlobUrl,
}: FindingCardProps) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.info;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<"fix" | "path" | null>(null);
  const [resolved, setResolved] = useState(false);

  function copy(text: string, what: "fix" | "path") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    }).catch(() => {});
  }

  return (
    <article
      className={`relative rounded-xl border overflow-hidden transition-all ${
        resolved
          ? "border-emerald/20 bg-emerald/[0.03] opacity-70"
          : "border-surface-border bg-surface-raised hover:border-accent/30 hover:shadow-card-hover"
      }`}
      aria-label={`${meta.label} ${category}: ${title}`}
    >
      {/* Severity bar — left edge */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.bar}`} aria-hidden="true" />

      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="w-full text-left px-5 py-4 flex items-start gap-3"
      >
        {/* Severity pill */}
        <div className="shrink-0 flex flex-col items-center gap-1.5 pt-0.5">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${meta.pill}`}>
            {meta.label}
          </span>
          {typeof index === "number" && typeof total === "number" && (
            <span className="text-[10px] font-mono text-text-muted">{index + 1}/{total}</span>
          )}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{category}</span>
            {classification && (
              <span className="text-[10px] font-mono text-text-muted bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/5">
                {classification}
              </span>
            )}
          </div>
          <p className={`text-sm font-medium mt-1 leading-snug ${resolved ? "line-through text-text-muted" : "text-text-primary"}`}>
            {title}
          </p>
          <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
              <path d="M4 4h8l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" strokeLinejoin="round" />
              <path d="M12 4v4h4" />
            </svg>
            <code className="font-mono truncate min-w-0">
              {filePath}
              {lineHint && <span className="text-text-muted/70">:{lineHint}</span>}
            </code>
          </div>
        </div>

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 shrink-0 text-text-muted transition-transform mt-1 ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
        >
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-white/5 px-5 py-4 space-y-4 bg-surface/40">
          {/* Why / impact */}
          {description && (
            <section>
              <SectionLabel icon={<InfoIcon />} text="Why this matters" />
              <p className="text-sm text-text-secondary leading-relaxed mt-1.5 whitespace-pre-wrap">
                {description}
              </p>
            </section>
          )}

          {/* How to fix */}
          <section>
            <div className="flex items-center justify-between gap-2">
              <SectionLabel icon={<WrenchIcon />} text="Suggested fix" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); copy(remediation, "fix"); }}
                className="text-[11px] text-text-muted hover:text-text-primary inline-flex items-center gap-1 transition-colors"
                aria-label="Copy suggested fix to clipboard"
              >
                {copied === "fix" ? (
                  <>
                    <svg className="w-3 h-3 text-emerald" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                      <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <CopyIcon />
                    Copy
                  </>
                )}
              </button>
            </div>
            <div className="mt-1.5 rounded-lg bg-accent/5 border border-accent/15 px-3 py-2.5">
              <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                {remediation}
              </p>
            </div>
          </section>

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); copy(filePath + (lineHint ? `:${lineHint}` : ""), "path"); }}
              className="btn-ghost text-xs"
            >
              {copied === "path" ? "Path copied" : "Copy path"}
            </button>
            {githubBlobUrl && (
              <a
                href={githubBlobUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="btn-ghost text-xs"
              >
                Open on GitHub
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M11 4h5v5M16 4l-7 7M9 5H5a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setResolved(r => !r); }}
              className={`btn-ghost text-xs ml-auto ${resolved ? "text-emerald" : ""}`}
              aria-pressed={resolved}
            >
              {resolved ? (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Resolved
                </>
              ) : (
                "Mark as resolved"
              )}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Severity filter — used above a list of FindingCards
   ──────────────────────────────────────────────────────────────────── */

export function SeverityFilter({
  counts,
  active,
  onChange,
}: {
  counts: Record<Severity, number>;
  active: Severity | "all";
  onChange: (next: Severity | "all") => void;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const order: Array<Severity | "all"> = ["all", "critical", "high", "medium", "low", "info"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {order.map(key => {
        const isAll = key === "all";
        const count = isAll ? total : counts[key as Severity] || 0;
        const meta = isAll ? null : SEVERITY_META[key as Severity];
        const isActive = active === key;
        if (!isAll && count === 0) return null; // hide empty buckets
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              isActive
                ? "bg-accent/15 text-accent border-accent/30"
                : "bg-surface-overlay/60 text-text-secondary border-surface-border hover:bg-surface-overlay"
            }`}
          >
            {meta && <span className={`w-1.5 h-1.5 rounded-full ${meta.bar}`} />}
            <span className="capitalize">{isAll ? "All" : meta?.label}</span>
            <span className={`text-[10px] font-mono ${isActive ? "text-accent/80" : "text-text-muted"}`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Score header card — used at the top of an audit/security tab
   ──────────────────────────────────────────────────────────────────── */

export function FindingScoreHeader({
  score,
  scoreLabel,
  summary,
  totalFindings,
  severityCounts,
  scoreTone,
}: {
  score: number;
  scoreLabel: string;
  summary?: string;
  totalFindings: number;
  severityCounts: Record<Severity, number>;
  scoreTone: "emerald" | "accent" | "amber" | "rose";
}) {
  const toneText: Record<string, string> = {
    emerald: "text-emerald", accent: "text-accent", amber: "text-amber", rose: "text-rose",
  };
  const color = toneText[scoreTone];

  return (
    <div className="card-glass p-6 sm:p-7">
      <div className="flex items-start gap-6 flex-wrap sm:flex-nowrap">
        {/* Ring */}
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-surface-border" />
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6"
              strokeDasharray={`${score * 2.64} 264`} strokeLinecap="round" className={color} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${color} leading-none tabular-nums`}>{Math.round(score)}</span>
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${color} mt-0.5`}>{scoreLabel}</span>
          </div>
        </div>

        {/* Summary + severity strip */}
        <div className="min-w-0 flex-1">
          <p className="text-text-secondary text-sm leading-relaxed">
            {summary || `${totalFindings} finding${totalFindings === 1 ? "" : "s"} surfaced from the latest scan.`}
          </p>

          {/* Severity strip — visual breakdown */}
          {totalFindings > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden bg-white/[0.04]" role="img" aria-label="Severity distribution">
                {(["critical", "high", "medium", "low", "info"] as Severity[]).map(s => {
                  const c = severityCounts[s] || 0;
                  if (c === 0) return null;
                  const pct = (c / totalFindings) * 100;
                  return <div key={s} className={SEVERITY_META[s].bar} style={{ width: `${pct}%` }} title={`${SEVERITY_META[s].label}: ${c}`} />;
                })}
              </div>
              <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                {(["critical", "high", "medium", "low", "info"] as Severity[]).map(s => {
                  const c = severityCounts[s] || 0;
                  if (c === 0) return null;
                  return (
                    <span key={s} className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`w-2 h-2 rounded-full ${SEVERITY_META[s].bar}`} />
                      <span className="text-text-muted">{SEVERITY_META[s].label}</span>
                      <span className="text-text-primary font-mono tabular-nums">{c}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Local helpers
   ──────────────────────────────────────────────────────────────────── */

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
      <span className="text-text-muted/80">{icon}</span>
      {text}
    </div>
  );
}

function InfoIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4M8 5v.01" strokeLinecap="round" />
    </svg>
  );
}
function WrenchIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M11.5 2.5a3 3 0 11-2.74 4.21l-5.7 5.7a1.5 1.5 0 102.12 2.12l5.7-5.7A3 3 0 1011.5 2.5z" strokeLinejoin="round" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
    </svg>
  );
}
