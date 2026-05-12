"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { repos as reposApi, Repo } from "@/lib/api";
import { qualityDescriptor } from "@/lib/qualityScore";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { BackendStatusBanner } from "@/components/ui/BackendStatusBanner";
import {
  LanguageDot, StatusIcon,
  FlaskIcon, ExpressIcon, FastAPIIcon, EmptyRepoIcon,
  FilesIcon, LinesIcon, QualityIcon,
} from "@/components/ui/RepoIcons";

/**
 * Curated for one-click demos — great intro to what RepoInsight does.
 * Each entry pairs a real public repo with an in-house framework icon
 * (originals, not copies of the upstream brand logos).
 */
interface FeaturedRepo {
  url: string;
  label: string;
  desc: string;
  tag: string;
  Icon: ({ className }: { className?: string }) => JSX.Element;
  /** Tailwind text-color class used for the icon and the accent. */
  tone: string;
}

const FEATURED_REPOS: FeaturedRepo[] = [
  { url: "https://github.com/pallets/flask",     label: "Flask",   desc: "Lightweight Python web framework", tag: "Python",     Icon: FlaskIcon,    tone: "text-emerald" },
  { url: "https://github.com/expressjs/express", label: "Express", desc: "Fast, minimalist Node.js framework", tag: "JavaScript", Icon: ExpressIcon,  tone: "text-amber" },
  { url: "https://github.com/fastapi/fastapi",   label: "FastAPI", desc: "Modern Python API framework",        tag: "Python",     Icon: FastAPIIcon,  tone: "text-cyan" },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadRepos = useCallback(async () => {
    try { const d = await reposApi.list(); setRepoList(d.repos); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  // While any repo is indexing, poll a LIGHTWEIGHT progress endpoint —
  // not the full list. The full list returns 100s of KB of cached AI
  // artifacts per row that the dashboard never displays. /progress only
  // returns id/status/indexed/total per still-indexing repo, ~50 bytes/row.
  useEffect(() => {
    const stillIndexing = repoList.some(
      r => r.index_status === "pending" || r.index_status === "indexing",
    );
    if (!stillIndexing) return;
    const i = setInterval(async () => {
      try {
        const progress = await reposApi.listProgress();
        if (progress.length === 0) {
          // Everything's done — do one final full refresh so we pick up
          // the freshly-populated cached fields, then stop polling.
          await loadRepos();
          clearInterval(i);
          return;
        }
        setRepoList((prev) =>
          prev.map((r) => {
            const p = progress.find((x) => x.id === r.id);
            return p
              ? { ...r, index_status: p.index_status, indexed_files: p.indexed_files, total_files: p.total_files }
              : r;
          }),
        );
      } catch {
        // Transient errors fine — retry on next tick.
      }
    }, 4000);
    return () => clearInterval(i);
  }, [repoList, loadRepos]);

  async function handleImport(e: React.FormEvent, urlOverride?: string) {
    e.preventDefault();
    const url = (urlOverride ?? importUrl).trim();
    if (!url) return;
    setImporting(true); setError("");
    try {
      await reposApi.import(url);
      setImportUrl("");
      await loadRepos();
      toast.success("Repository imported", "Indexing started — you'll see progress below.");
    }
    catch (e: any) {
      setError(e.message);
      toast.error("Could not import", e.message);
    }
    finally { setImporting(false); }
  }

  async function handleDelete(repoId: number, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const repo = repoList.find(r => r.id === repoId);
    const ok = await confirm({
      title: "Delete this repository?",
      description: `This removes the indexed content, tasks, chat history, and cached reports for ${repo?.full_name || "this repo"}. Your actual code on GitHub is NOT affected.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(repoId);
    try {
      await reposApi.delete(repoId);
      setRepoList(p => p.filter(r => r.id !== repoId));
      toast.success("Repository deleted");
    }
    catch (e: any) {
      toast.error("Could not delete", e.message);
    }
    finally { setDeletingId(null); }
  }

  async function handleReindex(repoId: number, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    try {
      await reposApi.reindex(repoId);
      await loadRepos();
      toast.info("Re-indexing started", "Fetching latest code from GitHub.");
    } catch (e: any) { toast.error("Re-index failed", e.message); }
  }

  const indexed = repoList.filter(r => r.is_indexed).length;
  const totalFiles = repoList.reduce((a, r) => a + r.total_files, 0);
  const totalLines = repoList.reduce((a, r) => a + r.total_lines, 0);

  return (
    <div className="max-w-6xl space-y-8 animate-fade-in">
      {/* Backend health — surfaces a banner when the API is unreachable so
          users don't run into confusing errors mid-task. Renders nothing
          when everything is healthy. */}
      <BackendStatusBanner />

      {/* Welcome header */}
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4">
        <div>
          <p className="eyebrow mb-3">
            <span className="status-dot" aria-hidden="true" />
            {greeting()}
          </p>
          <h1 className="text-display-3">
            Welcome back{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-text-secondary mt-1.5">
            {repoList.length === 0
              ? "Import your first repository and RepoInsight will analyze it with AI in under a minute."
              : `You have ${repoList.length} ${repoList.length === 1 ? "repository" : "repositories"} · ${indexed} ready to analyze`}
          </p>
        </div>
        {/* "Ask your code" button removed — chat is in the sidebar nav. */}
      </div>

      {/* Stats */}
      {repoList.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Repositories"
            value={repoList.length}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" /></svg>}
            accent="accent"
          />
          <StatCard
            label="Indexed"
            value={indexed}
            total={repoList.length}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            accent="emerald"
          />
          <StatCard
            label="Total files"
            value={totalFiles.toLocaleString()}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M13 2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V6zM13 2v4h4" strokeLinejoin="round" /></svg>}
            accent="cyan"
          />
          <StatCard
            label="Lines of code"
            value={totalLines.toLocaleString()}
            icon={<svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M5 6l-3 4 3 4M15 6l3 4-3 4M12 4l-4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            accent="violet"
          />
        </div>
      )}

      {/* Import */}
      <div className="card-glass p-6 space-y-4 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-accent/20 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative">
          <h2 className="font-semibold text-lg">Import a repository</h2>
          <p className="text-text-muted text-sm mt-1">
            Paste any public GitHub URL — yours or someone else&apos;s. For private repos, connect GitHub from Settings.
          </p>
        </div>
        <form onSubmit={handleImport} className="relative flex gap-2 flex-col sm:flex-row">
          <div className="relative flex-1">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.38.6.11.82-.25.82-.57v-2C4 22 3.5 19.5 3.5 19.5 3 18.5 2 18 2 18c-1-.73.08-.72.08-.72 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.3.76-1.6C5.62 17.6 2.66 16.6 2.66 12c0-1.3.47-2.39 1.24-3.23C3.78 8.47 3.36 7.24 4 5.6c0 0 1.01-.32 3.3 1.23A11.54 11.54 0 0112 6.34a11.54 11.54 0 014.7.49c2.29-1.55 3.29-1.23 3.29-1.23.65 1.64.24 2.87.12 3.17.77.84 1.23 1.93 1.23 3.23 0 4.62-2.97 5.6-5.78 5.9.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <label htmlFor="import-url" className="sr-only">
              GitHub repository URL
            </label>
            <input
              id="import-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="input w-full pl-9"
            />
          </div>
          <button type="submit" disabled={importing || !importUrl.trim()} aria-busy={importing} className="btn-glow whitespace-nowrap disabled:opacity-50">
            {importing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" aria-hidden="true" />
                Analyzing…
              </>
            ) : (
              <>
                Analyze
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>
        </form>
        {error && (
          <div role="alert" className="text-sm bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-danger">
            {error}
          </div>
        )}
      </div>

      {/* Repo list — ALWAYS visible */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Your Repositories</h2>
          {repoList.length > 0 && (
            <span className="text-xs text-text-muted">{repoList.length} total · {indexed} ready to analyze</span>
          )}
        </div>

        {loading ? (
          <div className="grid gap-3" aria-label="Loading repositories">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-5 flex items-center justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="skeleton h-5 w-48" />
                    <div className="skeleton h-5 w-24 rounded-full" />
                  </div>
                  <div className="skeleton h-4 w-2/3" />
                  <div className="flex gap-4">
                    <div className="skeleton h-3 w-12" />
                    <div className="skeleton h-3 w-16" />
                    <div className="skeleton h-3 w-14" />
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <div className="skeleton h-14 w-14 rounded-full" />
                  <div className="skeleton h-8 w-20 rounded-lg" />
                  <div className="skeleton h-8 w-16 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : repoList.length === 0 ? (
          <div className="card p-10 text-center space-y-6 animate-fade-in">
            {/* Empty-state hero icon — folder-with-spark, suggesting "new analysis lands here". */}
            <div className="inline-flex w-16 h-16 items-center justify-center rounded-2xl bg-accent-subtle">
              <EmptyRepoIcon className="w-8 h-8 text-accent" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">No repositories yet</h3>
              <p className="text-text-secondary text-sm mt-2 max-w-md mx-auto">
                Paste a GitHub URL above, or try one of these popular open-source projects with a single click.
              </p>
            </div>

            {/* Featured repos for instant value — each pinned to an original framework icon */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-2">
              {FEATURED_REPOS.map(r => (
                <button
                  key={r.url}
                  onClick={(e) => handleImport(e as any, r.url)}
                  disabled={importing}
                  className="card-hover p-4 text-left disabled:opacity-50 group"
                >
                  <div className="flex items-start gap-3">
                    <div className={`shrink-0 inline-flex w-9 h-9 items-center justify-center rounded-lg bg-surface-overlay/60 border border-white/5 ${r.tone} group-hover:scale-105 transition-transform`}>
                      <r.Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{r.label}</p>
                      <p className="text-xs text-text-muted leading-snug mt-0.5">{r.desc}</p>
                      <p className={`text-xs mt-2 flex items-center gap-1 ${r.tone}`}>
                        Analyze this repo
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {repoList.map(repo => (
              <Link key={repo.id} href={`/repos/${repo.id}`}
                className="card p-5 flex items-center justify-between hover:border-accent/30 transition-colors group">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-semibold group-hover:text-accent transition-colors">{repo.full_name}</h3>
                    <StatusBadge status={repo.index_status} files={`${repo.indexed_files}/${repo.total_files}`} />
                  </div>
                  <p className="text-text-secondary text-sm truncate">{repo.description || "No description"}</p>
                  {/* Stat row — language dot + iconified counts so the row scans at a glance
                      instead of being a wall of plain text. */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted items-center pt-0.5">
                    {repo.language && (
                      <span className="inline-flex items-center gap-1.5">
                        <LanguageDot language={repo.language} />
                        {repo.language}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <FilesIcon className="w-3 h-3" />
                      {repo.total_files.toLocaleString()} files
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <LinesIcon className="w-3 h-3" />
                      {repo.total_lines.toLocaleString()} lines
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 ml-4 shrink-0">
                  {repo.health_score != null && <HealthBadge score={repo.health_score} />}

                  {/* Re-index + Delete — always visible, side by side */}
                  <div className="flex items-center gap-1">
                    {repo.index_status === "indexing" || repo.index_status === "pending" ? (
                      <IndexingProgress
                        indexed={repo.indexed_files}
                        total={repo.total_files}
                        status={repo.index_status}
                      />
                    ) : (
                      <button
                        onClick={e => handleReindex(repo.id, e)}
                        className="btn-secondary text-xs px-3 py-1.5"
                        title="Re-fetch the latest code from GitHub and re-analyze it"
                      >
                        {repo.index_status === "failed" ? "Retry" : "Re-index"}
                      </button>
                    )}
                    <button
                      onClick={e => handleDelete(repo.id, e)}
                      disabled={deletingId === repo.id}
                      className="btn-danger text-xs px-3 py-1.5 disabled:opacity-40"
                      title="Remove this repo from RepoInsight (your GitHub code is not affected)"
                    >
                      {deletingId === repo.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5)  return "Good night";       // 12am–5am — winding down / pulling all-nighters
  if (h < 12) return "Good morning";     // 5am–12pm
  if (h < 17) return "Good afternoon";   // 12pm–5pm
  if (h < 22) return "Good evening";     // 5pm–10pm
  return "Good night";                   // 10pm–12am
}

function StatCard({ label, value, total, icon, accent }: {
  label: string;
  value: string | number;
  total?: number;
  icon: React.ReactNode;
  accent: "accent" | "cyan" | "violet" | "emerald";
}) {
  const colorMap: Record<string, { bg: string; text: string; glow: string }> = {
    accent:  { bg: "bg-accent-subtle",  text: "text-accent",  glow: "shadow-glow-sm" },
    cyan:    { bg: "bg-cyan-subtle",    text: "text-cyan",    glow: "" },
    violet:  { bg: "bg-violet-subtle",  text: "text-violet",  glow: "" },
    emerald: { bg: "bg-emerald-subtle", text: "text-emerald", glow: "" },
  };
  const c = colorMap[accent];
  return (
    <div className="card p-5 group transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-text-muted uppercase tracking-wider font-semibold">{label}</p>
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${c.bg} ${c.text}`}>
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className={`text-3xl font-bold tracking-tight ${c.text}`}>{value}</p>
        {total !== undefined && (
          <p className="text-sm text-text-muted">/ {total}</p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, files }: { status: string; files?: string }) {
  // Tone classes paired with a status key. Replacing the old emoji glyphs (✓ ⟳ ⧗ ✗)
  // with proper SVG icons so the badge renders identically across operating systems
  // and picks up the surrounding text color cleanly.
  const m: Record<string, [string, string]> = {
    done:     ["badge-emerald", "Ready"],
    indexing: ["badge-yellow",  `Indexing (${files})`],
    pending:  ["badge-yellow",  "Queued"],
    failed:   ["badge-red",     "Failed"],
  };
  const [cls, label] = m[status] || ["badge-blue", status];
  return (
    <span className={`${cls} inline-flex items-center gap-1.5`}>
      <StatusIcon status={status} className="w-3 h-3" />
      {label}
    </span>
  );
}

function HealthBadge({ score }: { score: number }) {
  const q = qualityDescriptor(score);
  const toneText: Record<string, string> = {
    emerald: "text-emerald",
    accent:  "text-accent",
    amber:   "text-amber",
    rose:    "text-rose",
  };
  return (
    <div className="text-right" title={q.description}>
      <span className={`text-2xl font-bold ${toneText[q.tone]}`}>{Math.round(score)}</span>
      <span className="text-base font-normal text-text-muted">/100</span>
      <span className={`text-[11px] flex items-center justify-end gap-1 font-medium ${toneText[q.tone]}`}>
        {q.label}
      </span>
      <span className="text-[10px] flex items-center justify-end gap-1 text-text-muted">
        <QualityIcon className="w-2.5 h-2.5" />
        Quality score
      </span>
    </div>
  );
}

function IndexingProgress({ indexed, total, status }: { indexed: number; total: number; status: string }) {
  // Track how long the card has been in the indexing state so we can explain
  // the "stuck at 0" period users see while the embedding model warms up
  // (typically 30-60s on first run — the sentence-transformers model loads into memory).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const pct = total > 0 ? Math.min(100, Math.round((indexed / total) * 100)) : 0;
  const isWaiting = status === "pending" || total === 0;

  // Message tier:
  //  0-15s:  "Starting…"          — worker picking up task
  //  15-90s: "Preparing model…"   — sentence-transformers is downloading/loading (normal)
  //  90s+:   "Still preparing…"   — something may be wrong but usually just a slow network
  let label = `Indexing ${indexed}/${total}`;
  if (isWaiting) {
    if (elapsed < 15) label = "Starting…";
    else if (elapsed < 90) label = "Preparing AI model…";
    else label = "Still preparing…";
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border border-warning/30 rounded-md min-w-[160px]"
      title={isWaiting
        ? "First-time setup: loading the embedding model (one-time, ~1 min). Subsequent repos are instant."
        : "Indexing in progress"}
    >
      <svg className="animate-spin w-3 h-3 text-warning shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M22 12a10 10 0 01-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 text-[11px] text-warning font-medium">
          <span className="truncate">{label}</span>
          {!isWaiting && <span className="text-[10px] text-text-muted shrink-0">{pct}%</span>}
        </div>
        <div className="h-1 bg-warning/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-warning transition-all duration-500 rounded-full"
            style={{ width: isWaiting ? `${Math.min(20, 8 + elapsed / 2)}%` : `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
