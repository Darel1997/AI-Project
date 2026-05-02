"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  repos as reposApi, ai as aiApi, tasks as tasksApi,
  billing, blastRadius, onboardingSim, tribalKnowledge, dependencyRadar, timeMachine,
  licenseScanner, prReviewer, costForecaster, migrationAssistant,
  Repo, TaskItem, CachedAudit, CachedDocs,
  SecurityResponse, OnboardingResponse, ArchitectureResponse,
  FeatureCatalog,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { FeaturePanel } from "@/components/ui/FeaturePanel";
import {
  BlastRadiusResult, OnboardingSimResult, TribalKnowledgeResult,
  DependencyRadarResult, TimeMachineResult,
  LicenseScannerResult, PRReviewerSetup,
  ComplianceSetup, KnowledgeGraphSearch,
  CodeDriftSetup, ADRsSetup, CostForecasterResult,
  MigrationAssistantSetup,
} from "@/components/repos/FeatureResults";
import {
  FindingCard, FindingScoreHeader, SeverityFilter,
  type Severity, severityRank,
} from "@/components/repos/FindingCard";
import {
  StatusIcon,
  FilesIcon, LinesIcon, QualityIcon,
} from "@/components/ui/RepoIcons";
import {
  getFeatureMeta, TONE_CLASSES,
} from "@/components/repos/featureMeta";
import { qualityDescriptor } from "@/lib/qualityScore";

type Tab = "overview";

export default function RepoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const repoId = Number(params.id);

  const [repo, setRepo] = useState<Repo | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [taskList, setTaskList] = useState<TaskItem[]>([]);
  const [auditData, setAuditData] = useState<CachedAudit | null>(null);
  const [docsData, setDocsData] = useState<CachedDocs | null>(null);
  const [securityData, setSecurityData] = useState<SecurityResponse | null>(null);
  const [onboardingData, setOnboardingData] = useState<OnboardingResponse | null>(null);
  const [archData, setArchData] = useState<ArchitectureResponse | null>(null);
  // Lab feature results — cached after first run so reopening the panel
  // shows the previous result with a Re-run button instead of a fresh load.
  // Each is null until that feature has been run at least once.
  const [labData, setLabData] = useState<Record<string, any>>({});
  // Per-feature running state. A slug is in this object (with `true`) while
  // its API call is in flight. Multiple features can run in parallel, so we
  // can't use a single string slot — we track each independently.
  // Re-clicking Run on a feature while it's already in this map is a no-op
  // (the same feature can only run once at a time), but every OTHER feature
  // remains free to run.
  const [runningSlugs, setRunningSlugs] = useState<Record<string, boolean>>({});
  // Non-feature actions (re-index, delete) that aren't part of the feature
  // catalog and don't need parallel-run support.
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  function startRun(slug: string) {
    setRunningSlugs(prev => ({ ...prev, [slug]: true }));
  }
  function endRun(slug: string) {
    setRunningSlugs(prev => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
  }
  function isRunning(slug: string): boolean {
    return !!runningSlugs[slug];
  }
  const [taskFilter, setTaskFilter] = useState<string>("all");
  // Severity filters for the Code Quality and Security tabs. "all" shows everything.
  const [qualityFilter, setQualityFilter] = useState<Severity | "all">("all");
  const [securityFilter, setSecurityFilter] = useState<Severity | "all">("all");
  // Tier-aware feature catalog drives which buttons are shown unlocked vs. locked.
  // Refetch on a 30s interval so a successful subscription change shows up quickly.
  const [featureCatalog, setFeatureCatalog] = useState<FeatureCatalog | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => billing.getFeatures()
      .then(c => { if (!cancelled) setFeatureCatalog(c); })
      .catch(() => { /* fall back to assuming free tier — rendered as locked */ });
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Whether a feature already has a cached result. Drives the panel's
  // "loading shell vs. inline refresh" decision — when re-running a feature
  // that already has a cached result, we keep the result visible while the
  // new fetch runs in the background instead of wiping the panel to a spinner.
  function hasCachedResult(slug: string): boolean {
    switch (slug) {
      case "documentation":     return !!docsData?.documentation;
      case "architecture":      return !!archData?.diagram;
      case "onboarding_guide":  return !!onboardingData?.guide;
      case "security_audit":    return !!securityData;
      case "code_quality":      return !!auditData?.items;
      case "task_generator":    return taskList.length > 0;
      default:                  return !!labData[slug];
    }
  }

  useEffect(() => {
    reposApi.get(repoId).then(setRepo).catch(() => router.push("/dashboard"));
    tasksApi.list(repoId).then(setTaskList).catch(() => {});
    // Load all cached AI artifacts so they persist between sessions
    aiApi.getAudit(repoId).then(d => { if (d.items) setAuditData(d); }).catch(() => {});
    aiApi.getDocs(repoId).then(d => { if (d.documentation) setDocsData(d); }).catch(() => {});
    aiApi.getSecurity(repoId).then(d => { if (d.findings.length > 0 || d.generated_at) setSecurityData(d); }).catch(() => {});
    aiApi.getOnboarding(repoId).then(d => { if (d.guide) setOnboardingData(d); }).catch(() => {});
    aiApi.getArchitecture(repoId).then(d => { if (d.diagram) setArchData(d); }).catch(() => {});
  }, [repoId, router]);

  // Poll for progress while indexing — updates the progress bar live without manual refresh
  useEffect(() => {
    if (!repo) return;
    if (repo.index_status !== "indexing" && repo.index_status !== "pending") return;
    const interval = setInterval(() => {
      reposApi.get(repoId).then(setRepo).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [repoId, repo]);

  // Open feature panel state — which feature is showing results, plus the data
  // Single-source-of-truth for which feature panel is open. `null` means
  // no panel — Overview is showing. Every feature button on the toolbar
  // sets this on click; closing the panel clears it. The actual result
  // for each feature lives in its own typed state below (auditData,
  // securityData, docsData, etc.) so a panel can re-open with cached
  // results instantly.
  const [panelSlug, setPanelSlug] = useState<string | null>(null);

  // ── Two-phase feature execution ─────────────────────────────────────
  //
  // Phase 1: clicking a toolbar button just OPENS the panel. No API call.
  //          The user sees an idle panel with a Run button.
  //
  // Phase 2: clicking Run inside the panel ACTUALLY EXECUTES the feature.
  //          This is the only place an API call gets made for results-style
  //          features. Setup-style features (PR Reviewer, Compliance, etc.)
  //          have their own form-and-submit machinery inside their result
  //          components, so they self-execute when the user submits the form.
  //
  // Why split them? Because the user wants:
  //   • Click → panel opens, no work happens yet
  //   • Multiple features can run in parallel (each Run kicks off its own request)
  //   • Closing the panel mid-run doesn't cancel; reopening shows current state
  //   • The same feature can't run twice concurrently (per-feature lock)
  //   • If a feature finishes while its panel is closed, the user gets a toast
  //
  // The set of slugs whose result lives in `labData[slug]` (lab features)
  // vs. dedicated typed state (auditData, securityData, etc.) is preserved
  // — only the *triggering* changed.

  /** Setup-style features that render a form inside their result component
   *  and self-execute on form submit. Clicking these on the toolbar opens
   *  the panel with the form ready; there is no separate Run button. */
  const SETUP_SLUGS = ["pr_reviewer", "compliance", "knowledge_graph", "code_drift", "adrs", "migration_assistant"];

  /** Phase 1 — open the panel. Used by every toolbar handler. */
  function openFeaturePanel(slug: string) {
    setPanelSlug(slug);
    // Setup features render their form immediately. The sentinel is a
    // pre-existing convention from the lab-feature wiring.
    if (SETUP_SLUGS.includes(slug) && !labData[slug]) {
      setLabData(prev => ({ ...prev, [slug]: { _setup: true } }));
    }
  }

  /** Phase 2 — actually execute. Called from inside the panel via the Run
   *  button. Per-feature lock: a second call while the same slug is in
   *  flight is a no-op. Other features can run concurrently. */
  async function runFeature(slug: string) {
    if (!repo) return;
    if (isRunning(slug)) return; // per-feature lock — one in-flight at a time
    if (SETUP_SLUGS.includes(slug)) return; // setup features have their own form

    startRun(slug);
    let succeeded = false;
    let errorMessage: string | null = null;
    try {
      // Each branch is responsible for fetching its own result and storing
      // it in the right state slot. Runs are independent — failing one
      // doesn't affect others.
      if (slug === "code_quality") {
        const d = await aiApi.runAudit(repoId);
        setAuditData({ ...d, generated_at: new Date().toISOString() });
      } else if (slug === "documentation") {
        const d = await aiApi.generateDocs(repoId);
        setDocsData({ documentation: d.documentation, files_analyzed: d.files_analyzed, generated_at: new Date().toISOString() });
      } else if (slug === "security_audit") {
        const d = await aiApi.runSecurity(repoId);
        setSecurityData({ ...d, generated_at: new Date().toISOString() });
      } else if (slug === "onboarding_guide") {
        const d = await aiApi.generateOnboarding(repoId);
        setOnboardingData(d);
      } else if (slug === "architecture") {
        const d = await aiApi.generateArchitecture(repoId);
        setArchData(d);
      } else if (slug === "task_generator") {
        const t = await tasksApi.generate(repoId);
        setTaskList(p => [...t, ...p]);
      } else if (slug === "blast_radius") {
        const r = await blastRadius.analyze({
          repository_id: repo.id,
          modified_files: ["README.md"],
          change_description: "Demo analysis from repo page",
        });
        setLabData(prev => ({ ...prev, [slug]: r }));
      } else if (slug === "onboarding_sim") {
        const r = await onboardingSim.simulate({ repository_id: repo.id });
        setLabData(prev => ({ ...prev, [slug]: r }));
      } else if (slug === "tribal_knowledge") {
        const r = await tribalKnowledge.capture(repo.id, "top-contributor");
        setLabData(prev => ({ ...prev, [slug]: r }));
      } else if (slug === "dependency_radar") {
        const r = await dependencyRadar.scan(repo.id);
        setLabData(prev => ({ ...prev, [slug]: r }));
      } else if (slug === "time_machine") {
        const r = await timeMachine.replay(repo.id, "src", 24);
        setLabData(prev => ({ ...prev, [slug]: r }));
      } else if (slug === "license_scanner") {
        const r = await licenseScanner.scan(repo.id);
        setLabData(prev => ({ ...prev, [slug]: r }));
      } else if (slug === "cost_forecaster") {
        const r = await costForecaster.forecast(repo.id);
        setLabData(prev => ({ ...prev, [slug]: r }));
      } else {
        return; // unknown slug — bail without touching state
      }
      succeeded = true;
    } catch (err: any) {
      // 402 means the user's tier doesn't unlock this feature.
      if (err?.message?.includes("requires the") || err?.message?.includes("plan")) {
        errorMessage = err.message;
        toast.error("Upgrade required", err.message);
      } else {
        errorMessage = err?.message || "Please try again in a moment.";
        toast.error(`${featureTitle(slug) || slug} failed`, errorMessage || undefined);
      }
    } finally {
      endRun(slug);
    }

    // Background-completion toast — if the user closed the panel while this
    // ran, they need a notification when it lands. We use a ref'd snapshot
    // of `panelSlug` taken at the time the run finishes (closure).
    // Because `panelSlug` may have changed since the run started, we read
    // the live state via a setter trick.
    setPanelSlug(currentPanel => {
      if (succeeded && currentPanel !== slug) {
        const title = featureTitle(slug) || slug;
        toast.success(`${title} finished`, "Click the feature button to view the result.");
      }
      return currentPanel;
    });
  }

  async function handleReindex() {
    setActionLoading("reindex");
    try {
      await reposApi.reindex(repoId);
      const u = await reposApi.get(repoId);
      setRepo(u);
      toast.success("Re-index started", "Your repository is being re-analyzed.");
    } catch (err: any) {
      toast.error("Re-index failed", err?.message || "Please try again in a moment.");
    } finally {
      setActionLoading(null);
    }
  }
  async function handleDelete() {
    const ok = await confirm({
      title: "Delete this repository?",
      description: `Removes ${repo?.full_name} — indexed content, chat history, tasks, and cached reports. Your actual code on GitHub is NOT affected.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setActionLoading("delete");
    try {
      await reposApi.delete(repoId);
      toast.success("Repository deleted");
      router.push("/dashboard");
    } catch (e: any) {
      toast.error("Could not delete", e.message);
      setActionLoading(null);
    }
  }
  async function handleTaskStatus(taskId: number, newStatus: string) {
    try {
      const updated = await tasksApi.updateStatus(taskId, newStatus);
      setTaskList(p => p.map(t => t.id === taskId ? updated : t));
    } catch (e: any) { toast.error("Could not update task", e.message); }
  }
  async function handleTaskDelete(taskId: number) {
    try { await tasksApi.remove(taskId); setTaskList(p => p.filter(t => t.id !== taskId)); }
    catch (e: any) { toast.error("Could not delete task", e.message); }
  }
  async function handleClearTasks() {
    const ok = await confirm({
      title: "Clear all tasks?",
      description: "This removes every task for this repository. You can generate new ones at any time.",
      confirmLabel: "Clear all",
      destructive: true,
    });
    if (!ok) return;
    try {
      await tasksApi.clearAll(repoId);
      setTaskList([]);
      toast.success("Tasks cleared");
    } catch (e: any) { toast.error("Could not clear tasks", e.message); }
  }

  function exportReport() {
    if (!repo) return;
    const lines: string[] = [
      `# ${repo.full_name} — RepoInsight Report`,
      ``,
      `Generated: ${new Date().toLocaleString()}`,
      ``,
      `## Overview`,
      `- Language: ${repo.language || "—"}`,
      `- Total files: ${repo.total_files}`,
      `- Indexed: ${repo.indexed_files} / ${repo.total_files}`,
      `- Lines: ${repo.total_lines.toLocaleString()}`,
      `- Quality: ${repo.health_score != null ? `${Math.round(repo.health_score)} (${qualityDescriptor(repo.health_score).label})` : "—"}`,
      ``,
    ];
    if (auditData?.items) {
      lines.push(`## Code Quality (Score: ${Math.round(auditData.overall_score || 0)}/100)`, ``, auditData.summary || "", ``);
      for (const i of auditData.items) lines.push(`- **[${i.severity.toUpperCase()}] ${i.file_path}**: ${i.issue}\n  *Fix:* ${i.suggestion}`);
      lines.push("");
    }
    if (securityData && securityData.findings.length) {
      lines.push(`## Security (Score: ${Math.round(securityData.security_score)}/100)`, ``, securityData.summary, ``);
      for (const f of securityData.findings) lines.push(`- **[${f.severity.toUpperCase()}] ${f.vulnerability}** in \`${f.file_path}\`: ${f.description}\n  *Fix:* ${f.remediation}`);
      lines.push("");
    }
    if (taskList.length) {
      lines.push(`## Tasks (${taskList.length})`, ``);
      for (const t of taskList) lines.push(`- [${t.status}] **${t.title}** (${t.priority}): ${t.description}`);
      lines.push("");
    }
    if (docsData?.documentation) { lines.push("## Documentation", "", docsData.documentation, ""); }
    if (onboardingData?.guide) { lines.push("## Onboarding Guide", "", onboardingData.guide, ""); }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${repo.name}-report.md`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!repo) return <div className="text-text-muted p-8">Loading...</div>;

  const filteredTasks = taskFilter === "all" ? taskList : taskList.filter(t => t.status === taskFilter);
  const taskCounts = { open: taskList.filter(t => t.status === "open").length, in_progress: taskList.filter(t => t.status === "in_progress").length, done: taskList.filter(t => t.status === "done").length };

  /* Panel-body render functions — these used to live as inline
     `{tab === "X" && (...)}` blocks on the page body. Lifted into the
     component closure so the unified FeaturePanel can switch on slug
     and render each one consistently. */
  const renderTasksView = () => (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {[
                { key: "all", label: "All", count: taskList.length },
                { key: "open", label: "Open", count: taskCounts.open },
                { key: "in_progress", label: "In Progress", count: taskCounts.in_progress },
                { key: "done", label: "Done", count: taskCounts.done },
              ].map(f => (
                <button key={f.key} onClick={() => setTaskFilter(f.key)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    taskFilter === f.key ? "bg-accent text-white" : "bg-surface-overlay text-text-secondary hover:text-text-primary"
                  }`}>
                  {f.label} ({f.count})
                </button>
              ))}
            </div>
            {taskList.length > 0 && (
              <button onClick={handleClearTasks} className="text-xs text-text-muted hover:text-danger transition-colors">
                Clear all tasks
              </button>
            )}
          </div>

          {/* Legend — explains difficulty levels for non-technical users */}
          {taskList.length > 0 && (
            <details className="card p-3 text-xs">
              <summary className="cursor-pointer text-text-secondary hover:text-text-primary font-medium flex items-center gap-2">
                <span>ⓘ</span> What do the priority and difficulty labels mean?
              </summary>
              <div className="mt-3 pt-3 border-t border-surface-border/50 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <p className="font-semibold text-text-primary">Priority</p>
                  <p><span className="badge-red">critical</span> Drop everything — serious risk or blocker</p>
                  <p><span className="badge-red">high</span> Important — tackle this sprint</p>
                  <p><span className="badge-yellow">medium</span> Valuable — schedule when possible</p>
                  <p><span className="badge-green">low</span> Nice to have — no rush</p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-text-primary">Difficulty</p>
                  <p><span className="badge-green">easy</span> ~1-2 hours · junior dev</p>
                  <p><span className="badge-blue">medium</span> ~half a day · some context needed</p>
                  <p><span className="badge-yellow">hard</span> ~1-2 days · senior dev recommended</p>
                  <p><span className="badge-red">complex</span> Multi-day · cross-system, design discussion</p>
                </div>
              </div>
            </details>
          )}

          {filteredTasks.length === 0 ? (
            <div className="card p-8 text-center text-text-muted">
              {taskList.length === 0 ? 'No tasks yet. Click "Generate Tasks" above.' : "No tasks match this filter."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map(task => (
                <div key={task.id} className={`card p-5 space-y-3 ${task.status === "done" ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className={`font-semibold text-sm ${task.status === "done" ? "line-through" : ""}`}>{task.title}</h4>
                        <PriorityBadge priority={task.priority} />
                        <DifficultyBadge difficulty={task.difficulty} />
                        <span className="badge-gray">{task.task_type}</span>
                      </div>
                      <p className="text-text-secondary text-sm mt-2 leading-relaxed">{task.description}</p>
                    </div>
                    <button onClick={() => handleTaskDelete(task.id)}
                      className="text-text-muted hover:text-danger p-1 rounded hover:bg-danger/10 transition-colors shrink-0" title="Delete task">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </div>

                  {task.suggested_files && task.suggested_files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {task.suggested_files.map(f => (
                        <span key={f} className="text-[11px] font-mono bg-surface-overlay px-2 py-0.5 rounded text-text-muted">{f}</span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1 border-t border-surface-border/50">
                    <span className="text-[11px] text-text-muted uppercase tracking-wider mr-2">Status:</span>
                    {["open", "in_progress", "done"].map(s => (
                      <button key={s} onClick={() => handleTaskStatus(task.id, s)}
                        className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${
                          task.status === s
                            ? s === "done" ? "bg-success/20 text-success ring-1 ring-success/30"
                            : s === "in_progress" ? "bg-warning/20 text-warning ring-1 ring-warning/30"
                            : "bg-accent/20 text-accent ring-1 ring-accent/30"
                            : "bg-surface-overlay text-text-muted hover:text-text-primary"
                        }`}>
                        {s === "open" ? "Open" : s === "in_progress" ? "In Progress" : "Done"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    );

  const renderCodeQualityView = () => (
        <div className="space-y-5">
          {auditData?.items ? (
            <>

              <FindingScoreHeader
                score={auditData.overall_score || 0}
                scoreLabel={qualityDescriptor(auditData.overall_score || 0).label}
                summary={auditData.summary}
                totalFindings={auditData.items.length}
                severityCounts={countSeveritiesQuality(auditData.items)}
                scoreTone={qualityDescriptor(auditData.overall_score || 0).tone as "emerald" | "accent" | "amber" | "rose"}
              />

              {/* Filter + summary */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <SeverityFilter
                  counts={countSeveritiesQuality(auditData.items)}
                  active={qualityFilter}
                  onChange={setQualityFilter}
                />
                <p className="text-xs text-text-muted">
                  Sorted by severity, highest first. Click any card to expand the suggested fix.
                </p>
              </div>

              {/* Findings */}
              {(() => {
                const sorted = [...auditData.items]
                  .map((it, originalIndex) => ({ it, originalIndex }))
                  .filter(({ it }) => qualityFilter === "all" || (it.severity || "info") === qualityFilter)
                  .sort((a, b) => severityRank(b.it.severity as Severity) - severityRank(a.it.severity as Severity));
                if (sorted.length === 0) {
                  return <EmptyState label={`No "${qualityFilter}" findings. Try a different filter.`} />;
                }
                return (
                  <div className="space-y-3">
                    {sorted.map(({ it, originalIndex }) => (
                      <FindingCard
                        key={originalIndex}
                        filePath={it.file_path}
                        severity={(it.severity || "info") as Severity}
                        category={it.category || "Code quality"}
                        title={it.issue}
                        remediation={it.suggestion}
                        index={originalIndex}
                        total={auditData.items!.length}
                        githubBlobUrl={buildGithubBlobUrl(repo, it.file_path)}
                      />
                    ))}
                  </div>
                );
              })()}
            </>
          ) : (
            <EmptyState label='Click "Code Quality" above to scan for code smells, complexity issues, and improvement opportunities.' />
          )}
        </div>
    );

  const renderSecurityView = () => (
        <div className="space-y-5">
          {securityData && (securityData.findings.length > 0 || securityData.generated_at) ? (
            <>

              <FindingScoreHeader
                score={securityData.security_score}
                scoreLabel={qualityDescriptor(securityData.security_score).label}
                summary={securityData.summary}
                totalFindings={securityData.findings.length}
                severityCounts={countSeveritiesSecurity(securityData.findings)}
                scoreTone={qualityDescriptor(securityData.security_score).tone as "emerald" | "accent" | "amber" | "rose"}
              />

              {securityData.findings.length > 0 ? (
                <>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <SeverityFilter
                      counts={countSeveritiesSecurity(securityData.findings)}
                      active={securityFilter}
                      onChange={setSecurityFilter}
                    />
                    <p className="text-xs text-text-muted">
                      Sorted by severity, highest first. Click any card to expand the remediation.
                    </p>
                  </div>

                  {(() => {
                    const sorted = [...securityData.findings]
                      .map((f, originalIndex) => ({ f, originalIndex }))
                      .filter(({ f }) => securityFilter === "all" || (f.severity || "info") === securityFilter)
                      .sort((a, b) => severityRank(b.f.severity as Severity) - severityRank(a.f.severity as Severity));
                    if (sorted.length === 0) {
                      return <EmptyState label={`No "${securityFilter}" findings. Try a different filter.`} />;
                    }
                    return (
                      <div className="space-y-3">
                        {sorted.map(({ f, originalIndex }) => (
                          <FindingCard
                            key={originalIndex}
                            filePath={f.file_path}
                            lineHint={f.line_hint}
                            severity={(f.severity || "info") as Severity}
                            category={f.vulnerability}
                            classification={f.cwe}
                            title={f.description}
                            remediation={f.remediation}
                            index={originalIndex}
                            total={securityData.findings.length}
                            githubBlobUrl={buildGithubBlobUrl(repo, f.file_path, f.line_hint)}
                          />
                        ))}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="card-glass p-8 text-center">
                  <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-emerald/15 border border-emerald/30 mb-3">
                    <svg className="w-5 h-5 text-emerald" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                      <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="font-semibold text-emerald">No security issues surfaced.</p>
                  <p className="text-text-muted text-xs mt-1">Re-run the scan after your next push to keep this report fresh.</p>
                </div>
              )}
            </>
          ) : (
            <EmptyState label='Click "Security Scan" above to find hardcoded secrets, injection risks, and authentication flaws.' />
          )}
        </div>
    );

  const renderOnboardingView = () => (
        <div className="card p-6">
          {onboardingData?.guide ? (
            <>
              <div className="flex items-center justify-end mb-4">
                <button onClick={() => navigator.clipboard.writeText(onboardingData.guide!)} className="btn-secondary text-xs">
                  Copy to clipboard
                </button>
              </div>
              <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed bg-surface p-4 rounded-lg border border-surface-border max-h-[600px] overflow-y-auto">
                {onboardingData.guide}
              </div>
            </>
          ) : (
            <EmptyState label='Generate a "new developer in 30 minutes" onboarding guide — setup steps, key files, gotchas, and suggested first tasks.' />
          )}
        </div>
    );

  const renderArchitectureView = () => (
        <div className="card p-6">
          {archData?.diagram ? (
            <>
              <div className="flex items-center justify-end mb-4">
                <button onClick={() => navigator.clipboard.writeText(archData.diagram!)} className="btn-secondary text-xs">
                  Copy Mermaid
                </button>
              </div>
              <MermaidDiagram chart={archData.diagram} />
              <details className="mt-4">
                <summary className="text-xs text-text-muted cursor-pointer hover:text-text-primary">View raw Mermaid source</summary>
                <pre className="mt-2 text-xs bg-surface p-3 rounded border border-surface-border overflow-x-auto">{archData.diagram}</pre>
              </details>
            </>
          ) : (
            <EmptyState label="Generate a Mermaid architecture diagram of your codebase — instantly see the big picture." />
          )}
        </div>
    );

  const renderDocsView = () => (
        <div className="card p-6">
          {docsData?.documentation ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-text-muted text-sm">{docsData.files_analyzed} files analyzed</p>
                <button onClick={() => navigator.clipboard.writeText(docsData.documentation!)} className="btn-secondary text-xs">
                  Copy to clipboard
                </button>
              </div>
              <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed bg-surface p-4 rounded-lg border border-surface-border max-h-[600px] overflow-y-auto">
                {docsData.documentation}
              </div>
            </>
          ) : (
            <EmptyState label='Click "Generate Docs" to create an architecture overview from your source code.' />
          )}
        </div>
    );


  return (
    <div className="max-w-6xl space-y-6">
      <button onClick={() => router.push("/dashboard")} className="text-text-secondary hover:text-text-primary text-sm flex items-center gap-1 transition-colors">
        &larr; Back to Dashboard
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold break-words">{repo.full_name}</h1>
          <p className="text-text-secondary mt-1 text-sm sm:text-base break-words">{repo.description || "No description"}</p>
        </div>
        <div className="flex gap-2 flex-wrap shrink-0">
          <a href={`/chat?repo=${repo.id}`} className="btn-primary text-sm">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M17 12a2 2 0 01-2 2H6l-3 3V4a2 2 0 012-2h10a2 2 0 012 2z" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Chat with Repo</span>
            <span className="sm:hidden">Chat</span>
          </a>
          <a href={`/analytics?repo=${repo.id}`} className="btn-secondary text-sm">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 17v-8M10 17V7M5 17v-5" strokeLinecap="round" />
            </svg>
            Analytics
          </a>
          <button onClick={exportReport} className="btn-secondary text-sm" title="Export full Markdown report">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M17 13v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3M6 8l4 4 4-4M10 12V3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Export Report</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>
      </div>

      {/* Stats — each block now carries a small icon so the row scans visually
          before you read the labels. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {(() => {
          const q = qualityDescriptor(repo.health_score);
          // For "Main language" the label uses a generic <code> tag glyph; the
          // language-specific colored dot only appears once, next to the value.
          // (Previously the dot rendered in BOTH places, which read as a duplicate.)
          const langTagIcon = (
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5.5 4l-3.5 4 3.5 4M10.5 4l3.5 4-3.5 4M9.5 3l-3 10" />
            </svg>
          );
          const items: { label: string; value: React.ReactNode; accent: string; icon: React.ReactNode }[] = [
            {
              label: "Main language",
              // Plain language name — no colored dot. The label icon (code tag)
              // is the single visual marker for this stat.
              value: repo.language || "—",
              accent: "violet",
              icon: langTagIcon,
            },
            { label: "Files",   value: repo.total_files,                                             accent: "cyan",    icon: <FilesIcon className="w-3 h-3" /> },
            { label: "Indexed", value: `${repo.indexed_files}/${repo.total_files}`,                  accent: "emerald", icon: <StatusIcon status="done" className="w-3 h-3" /> },
            { label: "Lines",   value: repo.total_lines.toLocaleString(),                            accent: "accent",  icon: <LinesIcon className="w-3 h-3" /> },
            { label: "Status",  value: capitalize(repo.index_status),                                accent: "amber",   icon: <StatusIcon status={repo.index_status} className="w-3 h-3" /> },
            {
              label: "Quality",
              value: repo.health_score != null ? `${Math.round(repo.health_score)} · ${q.label}` : "—",
              accent: q.tone,
              icon: <QualityIcon className="w-3 h-3" />,
            },
          ];
          return items;
        })().map(s => {
          const colorMap: Record<string, string> = {
            accent:  "text-accent",
            cyan:    "text-cyan",
            violet:  "text-violet",
            emerald: "text-emerald",
            amber:   "text-amber",
            rose:    "text-rose",
          };
          return (
            <div key={s.label} className="card px-3 py-2.5 sm:px-4 sm:py-3 hover:-translate-y-px transition-transform">
              <p className={`text-[10px] sm:text-[11px] uppercase tracking-wider font-semibold flex items-center gap-1.5 ${colorMap[s.accent]} opacity-80 truncate`}>
                <span className="shrink-0">{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </p>
              <p className={`font-semibold mt-1 text-sm truncate ${colorMap[s.accent]}`}>{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* AI actions — gated by tier. Owner sees everything. Free users see free
          features; paid tiers progressively unlock more. The handlers themselves
          short-circuit if the feature is locked, but we also disable + lock the
          button so the user gets immediate visual feedback. */}
      <FeatureToolbar
        catalog={featureCatalog}
        repoIndexed={repo.is_indexed}
        runningSlugs={runningSlugs}
        handlers={{
          // Chat is the only odd duck — it's a navigation, not a panel feature.
          chat: () => router.push(`/chat?repo=${repo.id}`),
          // Every other feature uses the same one-line handler: open the panel.
          // Actual execution happens on the Run button inside the panel.
          documentation:        () => openFeaturePanel("documentation"),
          architecture:         () => openFeaturePanel("architecture"),
          onboarding_guide:     () => openFeaturePanel("onboarding_guide"),
          security_audit:       () => openFeaturePanel("security_audit"),
          code_quality:         () => openFeaturePanel("code_quality"),
          task_generator:       () => openFeaturePanel("task_generator"),
          dependency_radar:     () => openFeaturePanel("dependency_radar"),
          time_machine:         () => openFeaturePanel("time_machine"),
          onboarding_sim:       () => openFeaturePanel("onboarding_sim"),
          blast_radius:         () => openFeaturePanel("blast_radius"),
          tribal_knowledge:     () => openFeaturePanel("tribal_knowledge"),
          license_scanner:      () => openFeaturePanel("license_scanner"),
          pr_reviewer:          () => openFeaturePanel("pr_reviewer"),
          compliance:           () => openFeaturePanel("compliance"),
          knowledge_graph:      () => openFeaturePanel("knowledge_graph"),
          code_drift:           () => openFeaturePanel("code_drift"),
          adrs:                 () => openFeaturePanel("adrs"),
          cost_forecaster:      () => openFeaturePanel("cost_forecaster"),
          migration_assistant:  () => openFeaturePanel("migration_assistant"),
        }}
      />

      {/* Indexing status row */}
      <div className="flex justify-end">
        <div className="flex gap-2 items-center">
          {repo.index_status === "indexing" || repo.index_status === "pending" ? (
            <RepoIndexingProgress
              indexed={repo.indexed_files}
              total={repo.total_files}
              status={repo.index_status}
            />
          ) : (
            <button onClick={handleReindex} disabled={actionLoading === "reindex"} className="btn-secondary text-sm disabled:opacity-50">
              {actionLoading === "reindex" ? "Re-indexing…" : repo.index_status === "failed" ? "Retry" : "Re-index"}
            </button>
          )}
          <button onClick={handleDelete} disabled={actionLoading === "delete"} className="btn-danger text-sm disabled:opacity-50">
            {actionLoading === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {repo.index_status === "failed" && (
        <div className="card p-4 border-danger/30 bg-danger/5 text-sm">
          <span className="text-danger font-medium">
            ✗ Indexing failed — click Retry above to try again.
          </span>
        </div>
      )}

      {/* ── OVERVIEW ── */}
      <div className="space-y-4">
        <div className="card p-6 space-y-4">
          <h3 className="font-semibold">Repository Info</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 text-sm">
              {[
                ["Default Branch", repo.default_branch || "main"],
                ["Main Language", repo.language || "Unknown"],
                ["Commits", repo.total_commits],
                ["Contributors", repo.total_contributors],
                ["Forks", repo.forks],
                ["Open Issues", (repo as any).open_issues || 0],
                ["Indexed Files", `${repo.indexed_files} / ${repo.total_files}`],
                ["Lines of Code", repo.total_lines.toLocaleString()],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between py-2 border-b border-surface-border/50">
                  <span className="text-text-muted">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <WebhookPanel repoId={repo.id} repoFullName={repo.full_name} />
        </div>

      {/* All other feature views — Task Board, Code Quality, Security,
          Onboarding, Architecture, Docs — render inside the unified
          FeaturePanel below. The JSX that used to live here as
          `{tab === "..." && ...}` blocks is now lifted into the
          renderXView() functions defined at the top of this component;
          the panel's body switches on panelSlug to call the right one. */}

      {/* ── TASK BOARD ── */}
      {/* ── CODE QUALITY (formerly Tech Debt) ──
           Findings are presented as professional, action-oriented cards:
           where the issue lives, what it is (with category), why it matters,
           and concretely how to fix it. Sortable by severity, filterable,
           and each remediation can be copied to the clipboard. */}
      {/* ── SECURITY ──
           Same FindingCard layout as Code Quality. CWE classification rendered
           inline, line hints surfaced in the file path, "Open on GitHub" links
           jump straight to the offending line. */}
      {/* ── ONBOARDING ── */}
      {/* Unified feature panel — every feature opens here.
          The panel body has three states:
            • idle    → no result yet, not running → big Run button
            • running → spinner OR stale result + refreshing chip
            • done    → result rendered, Re-run button at top
          Setup features (pr_reviewer, compliance, etc.) skip these states
          entirely — they render their own form-and-submit UI. */}
      <FeaturePanel
        open={!!panelSlug}
        onClose={() => setPanelSlug(null)}
        title={featureTitle(panelSlug || undefined)}
        subtitle={featureSubtitle(panelSlug || undefined, repo)}
        badge={panelSlug ? { label: featureBadgeLabel(panelSlug), tone: featureBadgeTone(panelSlug) } : undefined}
        // Show the FeaturePanel's loading shell only when running AND no stale
        // result is on screen. With a cached result we keep it visible and
        // show a subtle refreshing chip inline.
        loading={!!panelSlug && isRunning(panelSlug) && !hasCachedResult(panelSlug)}
        loadingLabel={featureLoadingLabel(panelSlug || undefined)}
      >
        {panelSlug && repo && (
          <FeaturePanelBody
            slug={panelSlug}
            running={isRunning(panelSlug)}
            hasResult={hasCachedResult(panelSlug)}
            isSetup={SETUP_SLUGS.includes(panelSlug)}
            onRun={() => runFeature(panelSlug)}
          >
            {/* Lab feature results */}
            {panelSlug === "blast_radius"        && labData.blast_radius        && <BlastRadiusResult data={labData.blast_radius} />}
            {panelSlug === "onboarding_sim"      && labData.onboarding_sim      && <OnboardingSimResult data={labData.onboarding_sim} repoId={repo.id} />}
            {panelSlug === "tribal_knowledge"    && labData.tribal_knowledge    && <TribalKnowledgeResult data={labData.tribal_knowledge} />}
            {panelSlug === "dependency_radar"    && labData.dependency_radar    && <DependencyRadarResult data={labData.dependency_radar} />}
            {panelSlug === "time_machine"        && labData.time_machine        && <TimeMachineResult data={labData.time_machine} />}
            {panelSlug === "license_scanner"     && labData.license_scanner     && <LicenseScannerResult data={labData.license_scanner} repoId={repo.id} />}
            {panelSlug === "cost_forecaster"     && labData.cost_forecaster     && <CostForecasterResult data={labData.cost_forecaster} />}
            {/* Setup features — render their own form + run logic */}
            {panelSlug === "pr_reviewer"         && labData.pr_reviewer         && <PRReviewerSetup repoId={repo.id} />}
            {panelSlug === "compliance"          && labData.compliance          && <ComplianceSetup repoId={repo.id} />}
            {panelSlug === "knowledge_graph"     && labData.knowledge_graph     && <KnowledgeGraphSearch repoId={repo.id} />}
            {panelSlug === "code_drift"          && labData.code_drift          && <CodeDriftSetup repoId={repo.id} />}
            {panelSlug === "adrs"                && labData.adrs                && <ADRsSetup repoId={repo.id} />}
            {panelSlug === "migration_assistant" && labData.migration_assistant && <MigrationAssistantSetup repoId={repo.id} />}

            {/* Formerly-tab feature views — now rendered inline in the panel. */}
            {panelSlug === "documentation"     && renderDocsView()}
            {panelSlug === "architecture"      && renderArchitectureView()}
            {panelSlug === "onboarding_guide"  && renderOnboardingView()}
            {panelSlug === "security_audit"    && renderSecurityView()}
            {panelSlug === "code_quality"      && renderCodeQualityView()}
            {panelSlug === "task_generator"    && renderTasksView()}
          </FeaturePanelBody>
        )}
      </FeaturePanel>
    </div>
  );
}

/* ── FeaturePanelBody ─────────────────────────────────────────────────
   Wraps every feature's content inside the unified panel. Shows the right
   state for the current run-status:
     • idle    → no cached result, not running → big Run button
     • running → no cached result yet → handled by FeaturePanel's loading shell
                  (this component renders nothing; its parent shows the spinner)
     • running with stale result → renders cached result + a refreshing chip
     • done    → renders cached result + a small Re-run button at the top
     • setup   → just renders the children (the setup form has its own Run)
   ──────────────────────────────────────────────────────────────────── */
function FeaturePanelBody({
  slug,
  running,
  hasResult,
  isSetup,
  onRun,
  children,
}: {
  slug: string;
  running: boolean;
  hasResult: boolean;
  isSetup: boolean;
  onRun: () => void;
  children: React.ReactNode;
}) {
  // Setup features render their own form + run logic — pass straight through.
  if (isSetup) return <>{children}</>;

  // Idle: no result yet AND not running → invite the user to start the run.
  if (!hasResult && !running) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="w-14 h-14 rounded-2xl bg-accent-subtle flex items-center justify-center mb-5">
          <svg className="w-6 h-6 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
        <h3 className="text-base font-semibold mb-1.5">Ready to run</h3>
        <p className="text-sm text-text-secondary max-w-sm leading-relaxed mb-6">
          {featureSubtitleIdle(slug)}
        </p>
        <button
          type="button"
          onClick={onRun}
          className="btn-primary inline-flex items-center gap-2 px-5 py-2.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M5 3.5v9a0.5 0.5 0 00.77.42l7-4.5a0.5 0.5 0 000-.84l-7-4.5A0.5 0.5 0 005 3.5z" />
          </svg>
          Run {featureTitle(slug)}
        </button>
        <p className="text-[11px] text-text-muted mt-4 max-w-xs">
          You can close this panel and come back — the run keeps going in the background.
        </p>
      </div>
    );
  }

  // Running with no result yet — this branch should rarely render because
  // FeaturePanel's loading prop typically catches it. Kept for safety.
  if (running && !hasResult) {
    return null;
  }

  // Done — or running with stale cached data. Both render the result;
  // the running case adds a refreshing chip + the Re-run button is hidden.
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {running ? (
          <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent border border-accent/20">
            <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" aria-hidden="true" />
            Refreshing — showing your last result below
          </span>
        ) : (
          <span className="text-[11px] text-text-muted">Cached result. Click Re-run for a fresh analysis.</span>
        )}
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3v4h-4" />
            <path d="M2 13v-4h4" />
            <path d="M3 8a5 5 0 018-3l3 3M13 8a5 5 0 01-8 3l-3-3" />
          </svg>
          Re-run
        </button>
      </div>
      {children}
    </div>
  );
}

/** Per-feature one-liner shown on the idle screen. */
function featureSubtitleIdle(slug: string): string {
  return ({
    documentation:        "Generate human-readable docs from your source code.",
    architecture:         "Auto-draw a Mermaid diagram of the system's components.",
    onboarding_guide:     "Build a 30-minute starter guide for a new developer.",
    security_audit:       "Find hardcoded secrets, SQLi, XSS, and other CWE-classified findings.",
    code_quality:         "Surface code smells, complexity hotspots, and missing tests.",
    task_generator:       "Generate Jira-style tickets with priority and difficulty.",
    dependency_radar:     "Scan your dependencies for slow releases and healthier alternatives.",
    time_machine:         "Replay how a module evolved over the past two years.",
    onboarding_sim:       "Simulate a Day-1 / Week-1 / Month-1 onboarding plan.",
    blast_radius:         "Predict which files, tests, and services a diff will affect.",
    tribal_knowledge:     "Capture a senior engineer's institutional knowledge before they leave.",
    license_scanner:      "Inventory dependency licenses and flag policy violations.",
    cost_forecaster:      "Estimate AI/cloud costs based on the repo's usage patterns.",
  } as Record<string, string>)[slug] || "Run this feature to generate a fresh analysis.";
}

/* ── Feature panel labels ──────────────────────────────────────────── */
function featureTitle(slug?: string) {
  return ({
    blast_radius:     "Blast Radius",
    onboarding_sim:   "Onboarding Simulator",
    tribal_knowledge: "Tribal Knowledge Capture",
    dependency_radar: "Dependency Health Radar",
    time_machine:     "Codebase Time Machine",
    license_scanner:  "License & IP Scanner",
    pr_reviewer:      "AI PR Reviewer",
    compliance:       "Compliance Reports",
    knowledge_graph:  "Knowledge Graph Search",
    code_drift:       "Code Drift Detection",
    adrs:             "Living ADRs",
    cost_forecaster:  "Cost Forecaster",
    migration_assistant: "Migration Assistant",
  } as Record<string, string>)[slug || ""] || "Feature";
}
function featureSubtitle(slug: string | undefined, repo: Repo | null) {
  if (!slug || !repo) return undefined;
  return ({
    blast_radius:     `Predicting ripple effects across ${repo.full_name}`,
    onboarding_sim:   `Day 1 / Week 1 / Month 1 plan for ${repo.full_name}`,
    tribal_knowledge: `Institutional knowledge captured from ${repo.full_name}`,
    dependency_radar: `Dependency health analysis for ${repo.full_name}`,
    time_machine:     `Module evolution timeline — ${repo.full_name}`,
    license_scanner:  `Real-time license risk scan + SPDX SBOM for ${repo.full_name}`,
    pr_reviewer:      `Set up auto-comments on every PR in ${repo.full_name}`,
    compliance:       `SOC 2 / GDPR / HIPAA evidence for ${repo.full_name}`,
    knowledge_graph:  `Real call-graph search across ${repo.full_name}`,
    code_drift:       `Convention-violation detection for ${repo.full_name}`,
    adrs:             `Architectural decision records for ${repo.full_name}`,
    cost_forecaster:  `Monthly cloud-spend forecast from real IaC parsing`,
    migration_assistant: `File-by-file migration plans for ${repo.full_name}`,
  } as Record<string, string>)[slug];
}
function featureBadgeLabel(slug: string) {
  return ({
    blast_radius: "Team", onboarding_sim: "Team", tribal_knowledge: "Business",
    dependency_radar: "Pro", time_machine: "Pro",
    license_scanner: "Free", pr_reviewer: "Team",
    compliance: "Business", knowledge_graph: "Team",
    code_drift: "Team", adrs: "Team", cost_forecaster: "Pro",
    migration_assistant: "Team",
  } as Record<string, string>)[slug] || "Lab";
}
function featureBadgeTone(slug: string): "accent" | "violet" | "cyan" | "emerald" | "amber" | "rose" {
  return ({
    blast_radius: "violet", onboarding_sim: "violet", tribal_knowledge: "cyan",
    dependency_radar: "accent", time_machine: "emerald",
    license_scanner: "amber", pr_reviewer: "rose",
    compliance: "emerald", knowledge_graph: "cyan",
    code_drift: "amber", adrs: "violet", cost_forecaster: "emerald",
    migration_assistant: "rose",
  } as Record<string, "accent" | "violet" | "cyan" | "emerald" | "amber" | "rose">)[slug] || "accent";
}
function featureLoadingLabel(slug?: string) {
  return ({
    blast_radius:     "Computing blast radius…",
    onboarding_sim:   "Generating onboarding plan…",
    tribal_knowledge: "Capturing institutional knowledge…",
    dependency_radar: "Scanning dependency health…",
    time_machine:     "Reconstructing module history…",
    license_scanner:  "Scanning licenses across all dependencies…",
    pr_reviewer:      "Loading PR reviewer setup…",
    compliance:       "Loading compliance setup…",
    knowledge_graph:  "Loading search…",
    code_drift:       "Loading drift checker…",
    adrs:             "Loading ADRs…",
    cost_forecaster:  "Parsing IaC and applying price catalog…",
    migration_assistant: "Detecting applicable migrations…",
  } as Record<string, string>)[slug || ""] || "Working on it…";
}

function EmptyState({ label }: { label: string }) {
  return <div className="card p-12 text-center text-text-muted">{label}</div>;
}

function CachedHeader({ generated_at, onRefresh, loading }: { generated_at?: string; onRefresh: () => void; loading: boolean }) {
  if (!generated_at) return null;
  const date = new Date(generated_at);
  const ago = timeAgo(date);
  return (
    <div className="flex items-center justify-between text-xs text-text-muted mb-3 pb-3 border-b border-surface-border/50">
      <span>Last generated {ago}</span>
      <button onClick={onRefresh} disabled={loading} className="hover:text-text-primary transition-colors disabled:opacity-50">
        {loading ? "Refreshing..." : "↻ Refresh"}
      </button>
    </div>
  );
}

function timeAgo(date: Date): string {
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

/* ────────────────────────────────────────────────────────────────────
   Helpers shared by the Code Quality and Security tabs
   ──────────────────────────────────────────────────────────────────── */

function emptySeverityCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function bucketSeverity(s: string | undefined | null): Severity {
  const v = (s || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low" || v === "info") return v;
  return "info";
}

function countSeveritiesQuality(items: { severity?: string }[]): Record<Severity, number> {
  const out = emptySeverityCounts();
  for (const it of items) out[bucketSeverity(it.severity)] += 1;
  return out;
}

function countSeveritiesSecurity(findings: { severity?: string }[]): Record<Severity, number> {
  const out = emptySeverityCounts();
  for (const f of findings) out[bucketSeverity(f.severity)] += 1;
  return out;
}

/** Best-effort builder for a GitHub blob URL. Returns undefined if we don't have
 * enough info; the FindingCard simply hides the "Open on GitHub" button in that case.
 * `lineHint` is parsed permissively — accepts "42", "L42", "42-89", "L42-L89". */
function buildGithubBlobUrl(repo: Repo | null, filePath: string, lineHint?: string): string | undefined {
  if (!repo?.full_name || !filePath) return undefined;
  const branch = repo.default_branch || "main";
  let url = `https://github.com/${repo.full_name}/blob/${branch}/${filePath}`;
  if (lineHint) {
    const cleaned = lineHint.replace(/L/gi, "");
    const m = cleaned.match(/^(\d+)(?:\s*[-–:]\s*(\d+))?$/);
    if (m) {
      url += m[2] ? `#L${m[1]}-L${m[2]}` : `#L${m[1]}`;
    }
  }
  return url;
}

function ProgressRing({ score }: { score: number }) {
  const q = qualityDescriptor(score);
  const toneText: Record<string, string> = {
    emerald: "text-emerald", accent: "text-accent", amber: "text-amber", rose: "text-rose",
  };
  const color = toneText[q.tone];
  return (
    <div className="relative w-24 h-24 shrink-0" title={q.description}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-surface-border" />
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6"
          strokeDasharray={`${score * 2.64} 264`} strokeLinecap="round" className={color} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${color} leading-none`}>{Math.round(score)}</span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider ${color} mt-0.5`}>{q.label}</span>
      </div>
    </div>
  );
}

function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (window as any).mermaid || await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          // Wider canvas so big diagrams don't get cramped
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis" },
          themeVariables: {
            background: "#0b0f17",
            primaryColor: "#6aa9ff",
            primaryTextColor: "#e8eef7",
            primaryBorderColor: "#2a3344",
            lineColor: "#8491a5",
            secondaryColor: "#131824",
            tertiaryColor: "#1c2332",
            fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
          },
        });
        const id = "mmd-" + Date.now();
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled) {
          // Strip any fixed width/height Mermaid adds so CSS can control sizing
          const cleaned = svg
            .replace(/width="[^"]*"/, 'width="100%"')
            .replace(/height="[^"]*"/, '')
            .replace(/style="[^"]*max-width:\s*[^;"]+;?/, 'style="');
          setSvg(cleaned);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Could not render diagram");
      }
    })();
    return () => { cancelled = true; };
  }, [chart]);

  // Escape exits fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setFullscreen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (error) {
    return (
      <div className="bg-danger/5 border border-danger/30 rounded-lg p-4 text-danger text-sm" role="alert">
        <strong className="font-semibold">Diagram error:</strong> {error}
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="bg-surface rounded-lg border border-surface-border h-64 flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          Rendering diagram…
        </div>
      </div>
    );
  }

  const Controls = (
    <div className="flex items-center gap-1 bg-surface-overlay border border-surface-border rounded-lg p-1">
      <button
        onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-border rounded transition-colors"
        aria-label="Zoom out"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 10h10" strokeLinecap="round" /></svg>
      </button>
      <span className="text-xs text-text-muted font-mono px-1.5 min-w-[2.5rem] text-center" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => setZoom(z => Math.min(3, z + 0.1))}
        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-border rounded transition-colors"
        aria-label="Zoom in"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M10 5v10M5 10h10" strokeLinecap="round" /></svg>
      </button>
      <span className="w-px h-4 bg-surface-border mx-1" aria-hidden="true" />
      <button
        onClick={() => setZoom(1)}
        className="px-2 h-7 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-border rounded transition-colors"
        aria-label="Reset zoom"
      >
        Fit
      </button>
      <span className="w-px h-4 bg-surface-border mx-1" aria-hidden="true" />
      <button
        onClick={() => setFullscreen(f => !f)}
        className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-border rounded transition-colors"
        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        {fullscreen ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M13 3v4h4M7 17v-4H3M13 17v-4h4M7 3v4H3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );

  const diagramContent = (
    <div
      ref={containerRef}
      className={`bg-surface rounded-lg border border-surface-border overflow-auto flex items-center justify-center ${fullscreen ? "flex-1" : "max-h-[70vh] min-h-[400px]"}`}
    >
      <div
        className="mermaid-diagram-content"
        style={{
          transform: `scale(${zoom})`,
          // Center the transform so zooming in/out grows from the middle, not the corner.
          // The flex parent above keeps the unzoomed diagram visually centered too.
          transformOrigin: "center center",
          transition: "transform 0.2s ease-out",
          padding: "1.5rem",
          // Ensures the SVG can shrink to fit when the diagram is smaller than the viewport
          // but grows to its natural size when larger (so scrolling kicks in).
          maxWidth: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        // SVG is sanitized server-side + Mermaid strict security level
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );

  // Fullscreen overlay mode
  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[90] bg-surface/95 backdrop-blur-sm p-4 sm:p-8 flex flex-col animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-label="Architecture diagram — fullscreen"
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="2" y="2" width="6" height="6" rx="0.5" />
              <rect x="12" y="2" width="6" height="6" rx="0.5" />
              <rect x="12" y="12" width="6" height="6" rx="0.5" />
              <rect x="2" y="12" width="6" height="6" rx="0.5" />
            </svg>
            <h2 className="font-semibold">Architecture Diagram</h2>
            <span className="text-text-muted text-xs hidden sm:inline">· Press <kbd className="kbd">Esc</kbd> to close</span>
          </div>
          {Controls}
        </div>
        {diagramContent}
      </div>
    );
  }

  // Inline mode
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        {Controls}
      </div>
      {diagramContent}
    </div>
  );
}

async function loadMermaid(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).mermaid) return resolve((window as any).mermaid);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
    s.onload = () => resolve((window as any).mermaid);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function PriorityBadge({ priority }: { priority: string }) {
  const m: Record<string, [string, string]> = {
    critical: ["badge-red", "Drop everything — serious risk or blocker"],
    high: ["badge-red", "Important — tackle this sprint"],
    medium: ["badge-yellow", "Valuable — schedule when possible"],
    low: ["badge-green", "Nice to have — no rush"],
  };
  const [cls, tooltip] = m[priority] || ["badge-blue", priority];
  return <span className={cls} title={tooltip}>{priority}</span>;
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const m: Record<string, [string, string]> = {
    easy:    ["badge-green",  "Easy · ~1-2 hours · A junior dev can handle this alone"],
    medium:  ["badge-blue",   "Medium · ~half a day · Requires some understanding of the codebase"],
    hard:    ["badge-yellow", "Hard · ~1-2 days · Needs a senior dev or deep context"],
    complex: ["badge-red",    "Complex · Multi-day · Touches many systems, requires design discussion"],
  };
  const [cls, tooltip] = m[difficulty] || ["badge-blue", `Difficulty: ${difficulty}`];
  return <span className={cls} title={tooltip}>{difficulty}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const m: Record<string, string> = { critical: "badge-red", high: "badge-red", medium: "badge-yellow", low: "badge-green", info: "badge-blue" };
  return <span className={m[severity] || "badge-blue"}>{severity}</span>;
}

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────
// FeatureToolbar — tier-aware AI actions row.
//
// Every button behaves identically: clicking opens the unified FeaturePanel
// (slide-out from the right) where the feature's result renders. There are
// no separate kinds anymore — the click is one consistent motion.
//
// Each button surfaces:
//   • the feature's original icon (from featureMeta)
//   • the feature's name
//   • a freshness dot if the cached result has been regenerated since the
//     user last opened it
//   • a "ready" indicator (subtle filled dot) if the feature already has a
//     cached result, so users can tell which features have been run before
//   • a lock badge + tier label if the user's plan doesn't include it
//
// Locked buttons route to /pricing on click. While the catalog is still
// loading we show skeleton pills so the layout doesn't shift.
// ─────────────────────────────────────────────────────────────────────
function FeatureToolbar({
  catalog,
  repoIndexed,
  runningSlugs,
  handlers,
}: {
  catalog: FeatureCatalog | null;
  repoIndexed: boolean;
  /** Map of slug → true while that feature's API call is in flight. The toolbar
   *  uses this for an optional subtle indicator on running buttons; it does
   *  NOT use it to disable clicks, because clicking the toolbar only opens
   *  the panel and never triggers a run on its own. */
  runningSlugs: Record<string, boolean>;
  handlers: Record<string, () => void>;
}) {
  const router = useRouter();

  // Loading skeleton — keep the same vertical space the toolbar will occupy
  if (!catalog) {
    return (
      <div className="flex gap-2 flex-wrap" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 w-32 rounded-lg skeleton" />
        ))}
      </div>
    );
  }

  // Drop chat — it's reachable from the sidebar nav, no need to duplicate.
  // Drop any feature we don't have a handler for (defensive — should never happen).
  // Sort by tier so free actions appear first.
  const tierOrder = ["free", "pro", "team", "business", "enterprise"];
  const features = catalog.features
    .filter(f => f.slug !== "chat" && handlers[f.slug])
    .slice()
    .sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));

  return (
    <div className="flex gap-2 flex-wrap items-center">
      {features.map(f => (
        <FeatureToolbarButton
          key={f.slug}
          feature={f}
          handler={handlers[f.slug]}
          repoIndexed={repoIndexed}
          isRunning={!!runningSlugs[f.slug]}
          onLockedClick={() => router.push("/pricing")}
        />
      ))}
    </div>
  );
}

function FeatureToolbarButton({
  feature: f,
  handler,
  repoIndexed,
  isRunning,
  onLockedClick,
}: {
  feature: FeatureCatalog["features"][number];
  handler: () => void;
  repoIndexed: boolean;
  /** True while this feature's API call is in flight. Doesn't disable the
   *  button — clicking just opens the panel. Drives a subtle pulse animation
   *  on the icon so users can see at a glance which features are working. */
  isRunning: boolean;
  onLockedClick: () => void;
}) {
  const meta = getFeatureMeta(f.slug);
  const tone = TONE_CLASSES[meta.tone];
  const Icon = meta.Icon;
  const isLocked = !f.unlocked;
  const baseDisabled = !repoIndexed; // chat is filtered out upstream so no special case here

  // Locked state — gray styling + lock badge + click goes to /pricing
  if (isLocked) {
    return (
      <button
        type="button"
        onClick={onLockedClick}
        title={`${f.description}\n\nRequires the ${f.tier.charAt(0).toUpperCase() + f.tier.slice(1)} plan. Click to upgrade.`}
        className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium
                   bg-surface-overlay/40 hover:bg-accent/5
                   border border-white/5 hover:border-accent/30
                   text-text-muted hover:text-text-primary transition-all duration-200
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="opacity-50 group-hover:opacity-80 transition-opacity">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span>{f.name}</span>
        <span className="ml-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-accent/80">
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <rect x="4" y="9" width="12" height="9" rx="1.5" />
            <path d="M7 9V6a3 3 0 016 0v3" />
          </svg>
          {f.tier}
        </span>
      </button>
    );
  }

  // Unlocked. Toolbar buttons just OPEN the panel — they never trigger an
  // API call directly. So the button stays clickable even while its feature
  // is running in the background; clicking it just brings the panel back so
  // the user can see progress or the eventual result.
  return (
    <button
      type="button"
      onClick={handler}
      disabled={baseDisabled}
      title={isRunning
        ? `${f.description}\n\nRunning now — click to open the panel and check progress.`
        : f.description}
      aria-label={f.name}
      aria-busy={isRunning || undefined}
      className={`group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium
                  bg-surface-overlay hover:bg-surface-hover
                  border border-white/5 ${tone.hoverBorder}
                  text-text-primary transition-all duration-200
                  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-white/5 disabled:hover:bg-surface-overlay disabled:hover:translate-y-0 disabled:hover:shadow-none
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                  hover:shadow-glow-sm hover:-translate-y-px`}
    >
      <span className={`${tone.text} group-hover:scale-110 transition-transform ${isRunning ? "animate-pulse" : ""}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span>{f.name}</span>
    </button>
  );
}

function AIActionButton({ onClick, disabled, loading, label, loadingLabel, icon }: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  label: string;
  loadingLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group relative inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium
                 bg-surface-overlay hover:bg-surface-hover
                 border border-white/5 hover:border-accent/30
                 text-text-primary transition-all duration-200
                 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/5
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                 hover:shadow-glow-sm hover:-translate-y-px"
    >
      {loading ? (
        <>
          <span className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" aria-hidden="true" />
          <span className="text-accent">{loadingLabel}</span>
        </>
      ) : (
        <>
          <span className="text-accent group-hover:scale-110 transition-transform">{icon}</span>
          {label}
        </>
      )}
    </button>
  );
}

function WebhookPanel({ repoId, repoFullName }: { repoId: number; repoFullName: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<import("@/lib/api").WebhookStatus | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    reposApi.webhookStatus(repoId).then(setStatus).catch(() => {});
  }, [repoId]);

  async function handleEnable() {
    setEnabling(true);
    try {
      const resp = await reposApi.webhookEnable(repoId);
      setSecret(resp.secret);
      setWebhookUrl(resp.webhook_url);
      setStatus(s => ({
        ...(s || { last_triggered_at: null, reindex_count: 0 }),
        enabled: true,
        has_secret: true,
        webhook_url: resp.webhook_url,
      }));
      toast.success("Webhook enabled", "Copy the secret and add it in GitHub");
    } catch (e: any) {
      toast.error("Could not enable webhook", e.message);
    } finally {
      setEnabling(false);
    }
  }

  async function handleDisable() {
    const ok = await confirm({
      title: "Disable auto re-index?",
      description: "GitHub will stop triggering re-indexes on push. You can re-enable anytime — the secret stays valid.",
      confirmLabel: "Disable",
    });
    if (!ok) return;
    try {
      await reposApi.webhookDisable(repoId);
      setStatus(s => s ? { ...s, enabled: false, webhook_url: null } : null);
      setSecret(null);
      setWebhookUrl(null);
      toast.success("Webhook disabled");
    } catch (e: any) {
      toast.error("Could not disable webhook", e.message);
    }
  }

  async function handleRotate() {
    const ok = await confirm({
      title: "Rotate webhook secret?",
      description: "A new secret will be generated. You must update it in GitHub's webhook settings, or future events will fail signature verification.",
      confirmLabel: "Rotate",
      destructive: true,
    });
    if (!ok) return;
    try {
      const resp = await reposApi.webhookRotateSecret(repoId);
      setSecret(resp.secret);
      toast.success("Secret rotated", "Update it in GitHub's webhook settings now");
    } catch (e: any) {
      toast.error("Could not rotate", e.message);
    }
  }

  function copy(value: string, field: string) {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  // Full webhook URL combining current origin + relative path
  const fullWebhookUrl = webhookUrl && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}${webhookUrl}`
    : null;

  const isEnabled = status?.enabled ?? false;

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold flex items-center gap-2 flex-wrap">
              Auto re-index on push
              {isEnabled ? (
                <span className="badge-green text-[10px]">Active</span>
              ) : (
                <span className="badge-gray text-[10px]">Inactive</span>
              )}
            </h3>
            <p className="text-text-secondary text-sm mt-1 text-pretty">
              Trigger a re-index automatically whenever you push to the default branch. Uses GitHub webhooks with HMAC-SHA256 signature verification.
            </p>
          </div>
        </div>
        {!isEnabled ? (
          <button onClick={handleEnable} disabled={enabling} className="btn-primary text-sm shrink-0 disabled:opacity-50">
            {enabling ? "Enabling…" : "Enable"}
          </button>
        ) : (
          <div className="flex gap-2 shrink-0">
            <button onClick={handleRotate} className="btn-secondary text-sm" title="Generate a new secret">
              Rotate secret
            </button>
            <button onClick={handleDisable} className="btn-ghost text-sm text-danger hover:bg-danger/5">
              Disable
            </button>
          </div>
        )}
      </div>

      {/* Stats row */}
      {isEnabled && status && (
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-surface-border/50">
          <div>
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted">Auto re-indexes</p>
            <p className="text-sm font-semibold mt-0.5">{status.reindex_count}</p>
          </div>
          <div>
            <p className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted">Last triggered</p>
            <p className="text-sm font-semibold mt-0.5">
              {status.last_triggered_at
                ? new Date(status.last_triggered_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : "Never"}
            </p>
          </div>
        </div>
      )}

      {/* Setup instructions — only shown when just enabled OR when secret was just rotated */}
      {(secret && fullWebhookUrl) && (
        <div className="space-y-3 pt-3 border-t border-surface-border/50 animate-slide-up">
          <div className="bg-accent-subtle border border-accent/30 rounded-lg p-4 space-y-3">
            <p className="font-semibold text-sm text-text-primary">Add this webhook to GitHub</p>
            <ol className="text-sm text-text-secondary space-y-2 leading-relaxed">
              <li>
                Go to{" "}
                <a
                  href={`https://github.com/${repoFullName}/settings/hooks/new`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent-hover underline underline-offset-4 font-mono text-xs"
                >
                  github.com/{repoFullName}/settings/hooks/new ↗
                </a>
              </li>
              <li>Paste the <strong className="text-text-primary">Payload URL</strong> and <strong className="text-text-primary">Secret</strong> below</li>
              <li>Set <strong className="text-text-primary">Content type</strong> to <code className="bg-surface px-1.5 py-0.5 rounded text-xs font-mono">application/json</code></li>
              <li>Choose <strong className="text-text-primary">"Just the push event"</strong></li>
              <li>Save — GitHub will send a ping event to verify</li>
            </ol>
          </div>

          <CopyField label="Payload URL" value={fullWebhookUrl} field="url" onCopy={copy} copied={copiedField === "url"} />
          <CopyField label="Secret" value={secret} field="secret" onCopy={copy} copied={copiedField === "secret"} sensitive />

          <p className="text-xs text-text-muted pt-1 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M10 6v4M10 14h.01M9 2.5L1.5 17h17L10 2.5H9z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              This is the only time we'll show the secret. If you lose it, click <strong className="text-text-secondary">Rotate secret</strong> to generate a new one.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function CopyField({ label, value, field, onCopy, copied, sensitive }: {
  label: string;
  value: string;
  field: string;
  onCopy: (v: string, f: string) => void;
  copied: boolean;
  sensitive?: boolean;
}) {
  const [shown, setShown] = useState(!sensitive);
  return (
    <div>
      <p className="text-xs text-text-muted uppercase tracking-wider mb-1">{label}</p>
      <div className="flex gap-2 items-center">
        <code className="flex-1 bg-surface-overlay border border-surface-border rounded-md px-3 py-2 text-xs font-mono truncate">
          {shown ? value : "•".repeat(Math.min(value.length, 40))}
        </code>
        {sensitive && (
          <button
            onClick={() => setShown(s => !s)}
            className="btn-ghost text-xs px-2 py-2"
            aria-label={shown ? "Hide secret" : "Show secret"}
          >
            {shown ? "Hide" : "Show"}
          </button>
        )}
        <button
          onClick={() => onCopy(value, field)}
          className="btn-secondary text-xs px-3 py-2 shrink-0"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-success" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="1.5" />
                <path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7" strokeLinecap="round" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function RepoIndexingProgress({ indexed, total, status }: { indexed: number; total: number; status: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((indexed / total) * 100)) : 0;
  const isWaiting = status === "pending" || total === 0;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 bg-warning/10 border border-warning/30 rounded-md min-w-[200px]" title="Indexing in progress">
      <svg className="animate-spin w-4 h-4 text-warning shrink-0" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
        <path d="M22 12a10 10 0 01-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 text-xs text-warning font-medium">
          <span>{isWaiting ? "Starting..." : `Indexing ${indexed}/${total} files`}</span>
          {!isWaiting && <span className="text-[11px] text-text-muted">{pct}%</span>}
        </div>
        <div className="h-1.5 bg-warning/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-warning transition-all duration-500 rounded-full"
            style={{ width: isWaiting ? "8%" : `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
