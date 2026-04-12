"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  repos as reposApi,
  ai as aiApi,
  tasks as tasksApi,
  Repo,
  TaskItem,
  TechDebtResponse,
  DocsResponse,
} from "@/lib/api";

type Tab = "overview" | "tasks" | "debt" | "docs";

export default function RepoDetailPage() {
  const params = useParams();
  const repoId = Number(params.id);

  const [repo, setRepo] = useState<Repo | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [taskList, setTaskList] = useState<TaskItem[]>([]);
  const [debtData, setDebtData] = useState<TechDebtResponse | null>(null);
  const [docsData, setDocsData] = useState<DocsResponse | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    reposApi.get(repoId).then(setRepo);
    tasksApi.list(repoId).then(setTaskList).catch(() => {});
  }, [repoId]);

  async function handleGenerateTasks() {
    setLoading("tasks");
    try {
      const newTasks = await tasksApi.generate(repoId);
      setTaskList((prev) => [...newTasks, ...prev]);
      setTab("tasks");
    } catch {}
    setLoading(null);
  }

  async function handleScanDebt() {
    setLoading("debt");
    try {
      const data = await aiApi.techDebt(repoId);
      setDebtData(data);
      setTab("debt");
    } catch {}
    setLoading(null);
  }

  async function handleGenerateDocs() {
    setLoading("docs");
    try {
      const data = await aiApi.generateDocs(repoId);
      setDocsData(data);
      setTab("docs");
    } catch {}
    setLoading(null);
  }

  if (!repo) {
    return <div className="text-text-muted">Loading repository...</div>;
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "tasks", label: `Tasks (${taskList.length})` },
    { key: "debt", label: "Tech Debt" },
    { key: "docs", label: "Documentation" },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{repo.full_name}</h1>
          <p className="text-text-secondary mt-1">
            {repo.description || "No description"}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/chat?repo=${repo.id}`} className="btn-primary text-sm">
            Chat with Code
          </a>
          <a href={`/analytics?repo=${repo.id}`} className="btn-secondary text-sm">
            Analytics
          </a>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Language", value: repo.language || "—" },
          { label: "Stars", value: repo.stars },
          { label: "Files", value: repo.total_files },
          { label: "Lines", value: repo.total_lines.toLocaleString() },
          { label: "Status", value: repo.index_status },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <p className="text-text-muted text-xs">{s.label}</p>
            <p className="font-semibold mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* AI action buttons */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleGenerateTasks}
          disabled={loading === "tasks"}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {loading === "tasks" ? "Generating..." : "Generate Tasks"}
        </button>
        <button
          onClick={handleScanDebt}
          disabled={loading === "debt"}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {loading === "debt" ? "Scanning..." : "Scan Tech Debt"}
        </button>
        <button
          onClick={handleGenerateDocs}
          disabled={loading === "docs"}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          {loading === "docs" ? "Generating..." : "Generate Docs"}
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-surface-border flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="card p-6 space-y-4">
          <h3 className="font-semibold">Repository Info</h3>
          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <span className="text-text-muted">Branch</span>
            <span className="font-mono">{repo.language || "main"}</span>
            <span className="text-text-muted">Commits</span>
            <span>{repo.total_commits}</span>
            <span className="text-text-muted">Contributors</span>
            <span>{repo.total_contributors}</span>
            <span className="text-text-muted">Forks</span>
            <span>{repo.forks}</span>
            <span className="text-text-muted">Indexed Files</span>
            <span>{repo.indexed_files} / {repo.total_files}</span>
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <div className="space-y-3">
          {taskList.length === 0 ? (
            <div className="card p-8 text-center text-text-muted">
              No tasks yet. Click &quot;Generate Tasks&quot; to create some.
            </div>
          ) : (
            taskList.map((task) => (
              <div key={task.id} className="card p-5 space-y-2">
                <div className="flex items-start justify-between">
                  <h4 className="font-semibold">{task.title}</h4>
                  <div className="flex gap-2">
                    <PriorityBadge priority={task.priority} />
                    <span className="badge-blue">{task.difficulty}</span>
                  </div>
                </div>
                <p className="text-text-secondary text-sm">{task.description}</p>
                {task.suggested_files && task.suggested_files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {task.suggested_files.map((f) => (
                      <span
                        key={f}
                        className="text-xs font-mono bg-surface-overlay px-2 py-0.5 rounded"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "debt" && (
        <div className="space-y-4">
          {debtData ? (
            <>
              <div className="card p-5 flex items-center gap-6">
                <div>
                  <p className="text-text-muted text-sm">Health Score</p>
                  <p
                    className={`text-4xl font-bold ${
                      debtData.overall_score >= 70
                        ? "text-success"
                        : debtData.overall_score >= 40
                          ? "text-warning"
                          : "text-danger"
                    }`}
                  >
                    {Math.round(debtData.overall_score)}
                  </p>
                </div>
                <p className="text-text-secondary text-sm flex-1">
                  {debtData.summary}
                </p>
              </div>
              {debtData.items.map((item, i) => (
                <div key={i} className="card p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <span className="badge-blue">{item.category}</span>
                    <span className="text-xs font-mono text-text-muted">
                      {item.file_path}
                    </span>
                  </div>
                  <p className="text-sm">{item.issue}</p>
                  <p className="text-sm text-text-secondary">
                    Fix: {item.suggestion}
                  </p>
                </div>
              ))}
            </>
          ) : (
            <div className="card p-8 text-center text-text-muted">
              Click &quot;Scan Tech Debt&quot; to analyze your codebase.
            </div>
          )}
        </div>
      )}

      {tab === "docs" && (
        <div className="card p-6">
          {docsData ? (
            <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap font-mono text-sm leading-relaxed">
              {docsData.documentation}
            </div>
          ) : (
            <p className="text-text-muted text-center py-8">
              Click &quot;Generate Docs&quot; to create documentation.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    critical: "badge-red",
    high: "badge-red",
    medium: "badge-yellow",
    low: "badge-green",
  };
  return <span className={map[priority] || "badge-blue"}>{priority}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "badge-red",
    high: "badge-red",
    medium: "badge-yellow",
    low: "badge-green",
  };
  return <span className={map[severity] || "badge-blue"}>{severity}</span>;
}
