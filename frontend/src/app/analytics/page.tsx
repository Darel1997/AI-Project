"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import {
  repos as reposApi,
  analytics as analyticsApi,
  Repo,
  AnalyticsData,
} from "@/lib/api";

const CHART_COLORS = [
  "#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff",
  "#79c0ff", "#56d364", "#e3b341", "#ff7b72", "#d2a8ff",
];

function AnalyticsContent() {
  const params = useSearchParams();
  const initialRepo = params.get("repo");

  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<number | null>(
    initialRepo ? Number(initialRepo) : null
  );
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    reposApi.list().then((d) => setRepoList(d.repos.filter((r) => r.is_indexed)));
  }, []);

  useEffect(() => {
    if (!selectedRepo) return;
    setLoading(true);
    analyticsApi
      .get(selectedRepo)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedRepo]);

  const langData = data
    ? Object.entries(data.language_breakdown).map(([name, value]) => ({
        name,
        value,
      }))
    : [];

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-text-secondary mt-1">
            Repository health and activity metrics
          </p>
        </div>
        <select
          value={selectedRepo || ""}
          onChange={(e) => setSelectedRepo(Number(e.target.value) || null)}
          className="input text-sm w-64"
        >
          <option value="">Select a repository...</option>
          {repoList.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
      </div>

      {!selectedRepo ? (
        <div className="card p-12 text-center text-text-muted">
          Select a repository to view analytics
        </div>
      ) : loading ? (
        <div className="card p-12 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto" />
          <p className="text-text-muted mt-4">Loading analytics...</p>
        </div>
      ) : data ? (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Health Score"
              value={Math.round(data.health_score)}
              suffix="/100"
              color={
                data.health_score >= 70
                  ? "text-success"
                  : data.health_score >= 40
                    ? "text-warning"
                    : "text-danger"
              }
            />
            <StatCard label="Total Commits" value={data.total_commits} />
            <StatCard label="Contributors" value={data.total_contributors} />
            <StatCard label="Lines of Code" value={data.total_lines.toLocaleString()} />
          </div>

          {/* Commit activity chart */}
          <div className="card p-6">
            <h3 className="font-semibold mb-4">Commit Activity (30 days)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.commit_activity}>
                <defs>
                  <linearGradient id="commitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#58a6ff" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#58a6ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis
                  dataKey="date"
                  stroke="#6e7681"
                  fontSize={11}
                  tickFormatter={(d) => d.slice(5)}
                />
                <YAxis stroke="#6e7681" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "#161b22",
                    border: "1px solid #30363d",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#58a6ff"
                  strokeWidth={2}
                  fill="url(#commitGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Language breakdown */}
            <div className="card p-6">
              <h3 className="font-semibold mb-4">Language Breakdown</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={langData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {langData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                    formatter={(value: number) => `${value}%`}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {langData.map((l, i) => (
                  <div key={l.name} className="flex items-center gap-1.5 text-xs">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="text-text-secondary">
                      {l.name} ({l.value}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top contributors */}
            <div className="card p-6">
              <h3 className="font-semibold mb-4">Top Contributors</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={data.top_contributors.slice(0, 8)}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                  <XAxis type="number" stroke="#6e7681" fontSize={11} />
                  <YAxis
                    dataKey="username"
                    type="category"
                    stroke="#6e7681"
                    fontSize={11}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#161b22",
                      border: "1px solid #30363d",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  />
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

function StatCard({
  label,
  value,
  suffix,
  color,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  color?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-text-muted text-sm">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color || ""}`}>
        {value}
        {suffix && (
          <span className="text-sm font-normal text-text-muted">{suffix}</span>
        )}
      </p>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div className="text-text-muted p-8">Loading analytics...</div>
      }
    >
      <AnalyticsContent />
    </Suspense>
  );
}
