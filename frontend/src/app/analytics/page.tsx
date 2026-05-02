"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { repos as reposApi, analytics as analyticsApi, Repo, AnalyticsData } from "@/lib/api";
import { qualityDescriptor } from "@/lib/qualityScore";
import { languageColor } from "@/components/ui/RepoIcons";

// Fallback palette for non-language data (commits, contributors, etc.) where
// language colors don't apply. Pie charts that ARE language data use
// languageColor() so the slice color matches the language's identity.
const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#79c0ff", "#56d364", "#e3b341", "#ff7b72", "#d2a8ff"];

function AnalyticsContent() {
  const params = useSearchParams();
  const initialRepo = params.get("repo");
  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<number | null>(null);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load repos + restore last selection
  useEffect(() => {
    reposApi.list().then(d => {
      const indexed = d.repos.filter(r => r.is_indexed);
      setRepoList(indexed);
      let target: number | null = null;
      if (initialRepo) target = Number(initialRepo);
      else {
        const saved = typeof window !== "undefined" ? localStorage.getItem("ri:lastAnalyticsRepo") : null;
        if (saved) target = Number(saved);
      }
      if (target && indexed.some(r => r.id === target)) setSelectedRepo(target);
    });
  }, [initialRepo]);

  // Persist selection
  useEffect(() => {
    if (selectedRepo) localStorage.setItem("ri:lastAnalyticsRepo", String(selectedRepo));
  }, [selectedRepo]);

  useEffect(() => {
    if (!selectedRepo) return;
    setLoading(true); setError("");
    analyticsApi.get(selectedRepo).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [selectedRepo]);

  const langData = data ? Object.entries(data.language_breakdown).map(([name, value]) => ({ name, value })) : [];

  return (
    <div className="max-w-6xl space-y-8 animate-fade-in">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div>
          <p className="eyebrow mb-3">
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 17l6-6 4 4 7-7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 8h6v6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Insights
          </p>
          <h1 className="text-display-3">Analytics</h1>
          <p className="text-text-secondary text-sm mt-1">Repository health, activity, and contributor metrics.</p>
        </div>
        <div className="relative w-full sm:w-auto">
          <select
            value={selectedRepo || ""}
            onChange={e => setSelectedRepo(Number(e.target.value) || null)}
            className="input text-sm w-full sm:w-64 appearance-none pr-9 cursor-pointer"
            aria-label="Select a repository"
          >
            <option value="">Select a repository…</option>
            {repoList.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
          </select>
          <svg className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {error && (
        <div role="alert" className="text-sm bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5 text-danger">
          {error}
        </div>
      )}

      {!selectedRepo ? (
        <AnalyticsEmptyState hasRepos={repoList.length > 0} />
      ) : loading ? (
        <AnalyticsSkeleton />
      ) : data ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(() => {
              const q = qualityDescriptor(data.health_score);
              const toneText: Record<string, string> = {
                emerald: "text-emerald", accent: "text-accent", amber: "text-amber", rose: "text-rose",
              };
              return (
                <div className="card p-5" title={q.description}>
                  <p className="text-text-muted text-sm">Quality score</p>
                  <p className={`text-3xl font-bold mt-1 ${toneText[q.tone]}`}>
                    {Math.round(data.health_score)}<span className="text-sm font-normal text-text-muted">/100</span>
                  </p>
                  <p className={`text-xs mt-1 font-medium ${toneText[q.tone]}`}>{q.label}</p>
                </div>
              );
            })()}
            <div className="card p-5"><p className="text-text-muted text-sm">Commits</p><p className="text-3xl font-bold mt-1">{data.total_commits}</p></div>
            <div className="card p-5"><p className="text-text-muted text-sm">Contributors</p><p className="text-3xl font-bold mt-1">{data.total_contributors}</p></div>
            <div className="card p-5"><p className="text-text-muted text-sm">Lines of Code</p><p className="text-3xl font-bold mt-1">{data.total_lines.toLocaleString()}</p></div>
          </div>

          {/* Commit chart */}
          <div className="card p-6">
            <h3 className="font-semibold mb-4">Commit Activity (30 days)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.commit_activity}>
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#58a6ff" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#58a6ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="date" stroke="#6e7681" fontSize={11} tickFormatter={d => d.slice(5)} />
                <YAxis stroke="#6e7681" fontSize={11} />
                <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", fontSize: "13px", color: "#ffffff" }} itemStyle={{ color: "#ffffff" }} labelStyle={{ color: "#ffffff" }} />
                <Area type="monotone" dataKey="count" stroke="#58a6ff" strokeWidth={2} fill="url(#cg)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Language pie */}
            <div className="card p-6">
              <h3 className="font-semibold mb-4">Language Breakdown</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={langData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} dataKey="value"
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                      if (percent < 0.05) return null;
                      const RAD = Math.PI / 180;
                      const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                      const x = cx + r * Math.cos(-midAngle * RAD);
                      const y = cy + r * Math.sin(-midAngle * RAD);
                      return (
                        <text x={x} y={y} fill="#ffffff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
                          {`${Math.round(percent * 100)}%`}
                        </text>
                      );
                    }} labelLine={false}>
                    {langData.map((l, i) => <Cell key={i} fill={languageColor(l.name)} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", fontSize: "13px", color: "#ffffff" }} itemStyle={{ color: "#ffffff" }} labelStyle={{ color: "#ffffff" }} formatter={(v: number) => `${v}%`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {langData.map((l) => (
                  <div key={l.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full ring-1 ring-black/10" style={{ background: languageColor(l.name) }} />
                    <span className="text-text-secondary">{l.name} ({l.value}%)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Contributors */}
            <div className="card p-6">
              <h3 className="font-semibold mb-4">Top Contributors</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.top_contributors.slice(0, 8)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                  <XAxis type="number" stroke="#6e7681" fontSize={11} />
                  <YAxis dataKey="username" type="category" stroke="#6e7681" fontSize={11} width={100} />
                  <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", fontSize: "13px", color: "#ffffff" }} itemStyle={{ color: "#ffffff" }} labelStyle={{ color: "#ffffff" }} />
                  <Bar dataKey="commits" fill="#58a6ff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsContent />
    </Suspense>
  );
}

function AnalyticsEmptyState({ hasRepos }: { hasRepos: boolean }) {
  return (
    <div className="card p-12 text-center space-y-4 animate-fade-in">
      <div className="inline-flex w-14 h-14 items-center justify-center rounded-2xl bg-accent-subtle">
        <svg className="w-7 h-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      </div>
      <div>
        <h2 className="text-lg font-semibold">Pick a repository</h2>
        <p className="text-text-secondary text-sm mt-1">
          {hasRepos
            ? "Choose an indexed repo from the dropdown above to see its analytics."
            : "Import a repo from the dashboard first, then come back here."}
        </p>
      </div>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-8" aria-label="Loading analytics">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="card p-5 space-y-2">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="card p-6 space-y-4">
        <div className="skeleton h-5 w-48" />
        <div className="skeleton h-[260px] w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map(i => (
          <div key={i} className="card p-6 space-y-4">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-[240px] w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

