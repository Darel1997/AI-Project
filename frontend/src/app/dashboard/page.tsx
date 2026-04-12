"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { repos as reposApi, Repo } from "@/lib/api";

export default function DashboardPage() {
  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadRepos();
  }, []);

  async function loadRepos() {
    try {
      const data = await reposApi.list();
      setRepoList(data.repos);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importUrl.trim()) return;
    setImporting(true);
    setError("");
    try {
      await reposApi.import(importUrl.trim());
      setImportUrl("");
      await loadRepos();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const indexed = repoList.filter((r) => r.is_indexed).length;
  const totalFiles = repoList.reduce((a, r) => a + r.total_files, 0);
  const totalLines = repoList.reduce((a, r) => a + r.total_lines, 0);

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-text-secondary mt-1">
          Your codebase intelligence overview
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Repositories", value: repoList.length, accent: false },
          { label: "Indexed", value: indexed, accent: true },
          { label: "Total Files", value: totalFiles.toLocaleString(), accent: false },
          { label: "Total Lines", value: totalLines.toLocaleString(), accent: false },
        ].map((stat) => (
          <div key={stat.label} className="card p-5">
            <p className="text-text-muted text-sm">{stat.label}</p>
            <p
              className={`text-3xl font-bold mt-1 ${stat.accent ? "text-accent" : ""}`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Import form */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold">Import a Repository</h2>
        <form onSubmit={handleImport} className="flex gap-3">
          <input
            type="text"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="input flex-1"
          />
          <button
            type="submit"
            disabled={importing}
            className="btn-primary whitespace-nowrap disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </form>
        {error && <p className="text-danger text-sm">{error}</p>}
      </div>

      {/* Repo list */}
      <div className="space-y-3">
        <h2 className="font-semibold">Your Repositories</h2>
        {loading ? (
          <div className="card p-8 text-center text-text-muted">
            Loading repositories...
          </div>
        ) : repoList.length === 0 ? (
          <div className="card p-8 text-center text-text-muted">
            No repositories yet. Import one above to get started.
          </div>
        ) : (
          <div className="grid gap-3">
            {repoList.map((repo) => (
              <Link
                key={repo.id}
                href={`/repos/${repo.id}`}
                className="card p-5 flex items-center justify-between hover:border-accent/30 transition-colors group"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold group-hover:text-accent transition-colors">
                      {repo.full_name}
                    </h3>
                    <StatusBadge status={repo.index_status} />
                  </div>
                  <p className="text-text-secondary text-sm">
                    {repo.description || "No description"}
                  </p>
                  <div className="flex gap-4 text-xs text-text-muted">
                    {repo.language && <span>{repo.language}</span>}
                    <span>★ {repo.stars}</span>
                    <span>{repo.total_files} files</span>
                    <span>{repo.total_lines.toLocaleString()} lines</span>
                  </div>
                </div>
                {repo.health_score !== null && repo.health_score !== undefined && (
                  <div className="text-right">
                    <HealthBadge score={repo.health_score} />
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done: "badge-green",
    indexing: "badge-yellow",
    pending: "badge-yellow",
    failed: "badge-red",
  };
  return <span className={styles[status] || "badge-blue"}>{status}</span>;
}

function HealthBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? "text-success" : score >= 40 ? "text-warning" : "text-danger";
  return (
    <div className={`text-right ${color}`}>
      <span className="text-2xl font-bold">{Math.round(score)}</span>
      <span className="text-xs block text-text-muted">Health</span>
    </div>
  );
}
