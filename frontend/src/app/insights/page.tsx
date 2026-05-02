"use client";

/**
 * /insights — cross-repo intelligence dashboard.
 *
 * Sits above any individual repo. Surfaces:
 *   - Duplicate logic candidates across repos
 *   - Shared concerns (auth, billing, etc.) and how they're implemented inconsistently
 *   - Dependency drift — same package, different versions across repos
 *   - Concrete library-extraction recommendations
 *
 * Business tier only — owner sees it always.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import Sidebar from "@/components/ui/Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { request, billing, FeatureCatalog } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface DuplicateLogicMatch {
  concept: string;
  repos: string[];
  files: { repo: string; file_path: string; snippet: string }[];
  similarity_score: number;
  extraction_value: "high" | "medium" | "low";
}
interface SharedConcern {
  concern: string;
  repos: string[];
  inconsistency_signals: string[];
  file_examples: { repo: string; file_path: string; snippet: string }[];
}
interface DependencyDrift {
  package_name: string;
  ecosystem: string;
  versions_by_repo: Record<string, string>;
  drift_severity: "minor" | "major" | "split-version";
  recommendation: string;
}
interface CrossRepoReport {
  user_id: number;
  repository_count: number;
  repository_names: string[];
  summary: string;
  duplicate_logic: DuplicateLogicMatch[];
  shared_concerns: SharedConcern[];
  dependency_drift: DependencyDrift[];
  extraction_recommendations: string[];
  generated_at: string;
}

export default function InsightsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [catalog, setCatalog] = useState<FeatureCatalog | null>(null);
  const [report, setReport] = useState<CrossRepoReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    billing.getFeatures().then(setCatalog).catch(() => {});
  }, []);

  const unlocked = catalog?.is_owner || catalog?.features.find(f => f.slug === "cross_repo")?.unlocked;

  async function runAnalysis() {
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const r = await request<CrossRepoReport>("/api/cross-repo/analyze", {
        method: "POST",
        body: JSON.stringify({ min_repos: 2, max_findings: 30 }),
      });
      setReport(r);
    } catch (err: any) {
      const msg = err.message || "Analysis failed";
      setError(msg);
      // 402 = upgrade required
      if (msg.toLowerCase().includes("requires") || msg.toLowerCase().includes("plan")) {
        toast.error("Upgrade required", msg);
      } else {
        toast.error("Analysis failed", msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <main className="flex-1 ml-64 px-8 py-10">
        <div className="max-w-6xl mx-auto space-y-8">
          <header>
            <p className="eyebrow text-accent mb-2">Cross-repo</p>
            <h1 className="text-2xl font-bold">Cross-repo intelligence</h1>
            <p className="text-text-secondary text-sm mt-1 max-w-2xl">
              Find duplicate logic, inconsistent shared concerns, and dependency drift across all your indexed repos.
              Surfaces real candidates for library extraction.
            </p>
          </header>

          {!unlocked && catalog && (
            <div className="card p-6 text-center space-y-3">
              <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-accent/10 border border-accent/30 mx-auto">
                <svg className="w-5 h-5 text-accent" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <rect x="4" y="9" width="12" height="9" rx="1.5" />
                  <path d="M7 9V6a3 3 0 016 0v3" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold">Business plan feature</h3>
                <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
                  Cross-repo intelligence requires the Business plan. Upgrade to unlock org-wide analysis.
                </p>
              </div>
              <Link href="/pricing" className="btn-primary text-sm inline-block">Upgrade</Link>
            </div>
          )}

          {unlocked && !report && (
            <div className="card p-6 space-y-4">
              <p className="text-sm text-text-secondary leading-relaxed">
                We'll scan all your indexed repositories, looking for code that's been reimplemented in multiple places.
                The analysis is grounded in real semantic search and real manifest comparison — no fabricated suggestions.
              </p>
              <button onClick={runAnalysis} disabled={loading} className="btn-primary text-sm">
                {loading ? "Scanning across repos…" : "Run cross-repo analysis"}
              </button>
              {error && <p className="text-xs text-rose">{error}</p>}
            </div>
          )}

          {report && <ReportView report={report} onReset={() => setReport(null)} />}
        </div>
      </main>
    </div>
  );
}

function ReportView({ report, onReset }: { report: CrossRepoReport; onReset: () => void }) {
  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <p className="text-text-secondary text-sm leading-relaxed flex-1 min-w-0">{report.summary}</p>
        <button onClick={onReset} className="btn-secondary text-xs shrink-0">New analysis</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Repos scanned" value={String(report.repository_count)} />
        <Stat label="Duplicate logic matches" value={String(report.duplicate_logic.length)} />
        <Stat label="Dependency drift items" value={String(report.dependency_drift.length)} />
      </div>

      {/* Extraction recommendations */}
      {report.extraction_recommendations.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Recommended extractions
          </h2>
          <div className="space-y-2">
            {report.extraction_recommendations.map((r, i) => (
              <div key={i} className="card p-4 flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-accent-subtle border border-accent/30 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">{r}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Duplicate logic */}
      {report.duplicate_logic.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Duplicate logic candidates
          </h2>
          <div className="space-y-3">
            {report.duplicate_logic.map((d, i) => <DuplicateCard key={i} match={d} />)}
          </div>
        </section>
      )}

      {/* Shared concerns */}
      {report.shared_concerns.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Shared concerns
          </h2>
          <div className="space-y-3">
            {report.shared_concerns.map((c, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{c.concern}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Implemented in {c.repos.length} repo(s): {c.repos.map(r => <code key={r} className="font-mono mx-0.5">{r}</code>)}
                    </p>
                  </div>
                </div>
                {c.inconsistency_signals.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-[10px] text-amber uppercase tracking-wider font-semibold">Inconsistency signals</p>
                    {c.inconsistency_signals.map((s, j) => (
                      <p key={j} className="text-xs text-text-secondary">⚠ {s}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Dependency drift */}
      {report.dependency_drift.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Dependency drift
          </h2>
          <div className="card divide-y divide-white/5 max-h-[400px] overflow-y-auto">
            {report.dependency_drift.map((d, i) => (
              <div key={i} className="p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-mono font-semibold">{d.package_name}</code>
                      <span className="text-[10px] text-text-muted uppercase tracking-wider">{d.ecosystem}</span>
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {Object.entries(d.versions_by_repo).map(([repo, ver]) => (
                        <div key={repo} className="text-xs text-text-secondary">
                          <code className="font-mono">{repo}</code>: <span className="text-accent">{ver}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-text-secondary mt-1.5 italic">→ {d.recommendation}</p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase shrink-0 ${
                    d.drift_severity === "split-version"
                      ? "text-rose bg-rose-subtle border-rose/30"
                      : "text-amber bg-amber-subtle border-amber/30"
                  }`}>
                    {d.drift_severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DuplicateCard({ match }: { match: DuplicateLogicMatch }) {
  const [open, setOpen] = useState(false);
  const valTone: Record<string, string> = {
    high:   "text-emerald bg-emerald-subtle border-emerald/30",
    medium: "text-amber bg-amber-subtle border-amber/30",
    low:    "text-text-muted bg-surface-overlay border-white/10",
  };
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full p-4 text-left hover:bg-white/[0.02] transition-colors">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm">{match.concept}</p>
            <p className="text-xs text-text-muted mt-0.5">
              Found in {match.repos.length} repos · {match.similarity_score}% similarity
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${valTone[match.extraction_value]}`}>
              {match.extraction_value} value
            </span>
            <svg className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-white/5 p-4 space-y-2 bg-white/[0.01]">
          {match.files.map((f, i) => (
            <div key={i} className="card p-2.5">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <code className="text-[11px] font-mono text-accent">{f.repo}</code>
                <span className="text-[10px] text-text-muted">·</span>
                <code className="text-[11px] font-mono text-text-secondary truncate">{f.file_path}</code>
              </div>
              <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed line-clamp-3">{f.snippet}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[10px] text-text-muted uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}
