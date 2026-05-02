"use client";

/**
 * Result renderers for the 5 unique-tier features.
 * Each component receives the API response and renders it inside a FeaturePanel body.
 *
 * These are designed to look polished even with sparse LLM output — defaults
 * everywhere, empty-state branches when arrays are empty, and never crash on
 * missing fields.
 */

import { useState, useEffect } from "react";
import {
  BlastRadiusReport, OnboardingPlan, OnboardingPhase, OnboardingCheckpoint,
  TribalKnowledgeDump, DependencyRadarReport, DependencyFinding,
  TimeMachineReport,
  onboardingSim,
} from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────
// 1. Blast Radius
// ─────────────────────────────────────────────────────────────────────
export function BlastRadiusResult({ data }: { data: BlastRadiusReport }) {
  const riskTone: Record<string, string> = {
    critical: "text-rose bg-rose-subtle border-rose/30",
    high:     "text-amber bg-amber-subtle border-amber/30",
    medium:   "text-accent bg-accent-subtle border-accent/30",
    low:      "text-emerald bg-emerald-subtle border-emerald/30",
  };

  return (
    <div className="space-y-6">
      {/* Score header */}
      <div className="card-glass p-5 flex items-center gap-5">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-surface-border" />
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6"
              strokeDasharray={`${data.risk_score * 2.64} 264`}
              strokeLinecap="round"
              className={data.risk_score >= 70 ? "text-rose" : data.risk_score >= 40 ? "text-amber" : "text-emerald"} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold leading-none">{data.risk_score}</span>
            <span className="text-[9px] uppercase tracking-wider mt-0.5 text-text-muted">risk</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-text-secondary text-sm leading-relaxed">{data.summary}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
            <span>~{data.estimated_review_time_minutes} min review</span>
            <span>·</span>
            <span className={`uppercase font-semibold ${data.risk_level === "critical" || data.risk_level === "high" ? "text-rose" : "text-emerald"}`}>{data.risk_level}</span>
          </div>
        </div>
      </div>

      {/* Affected files */}
      <section>
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
          Affected files <span className="text-text-muted/60 font-normal">({data.affected.length})</span>
        </h3>
        {data.affected.length === 0 ? (
          <EmptyHint label="No affected files identified." />
        ) : (
          <div className="card divide-y divide-white/5 max-h-[360px] overflow-y-auto">
            {data.affected.map((item, i) => (
              <div key={i} className="p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <code className="text-sm font-mono text-text-primary truncate block">{item.path}</code>
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">{item.reason}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] uppercase tracking-wider text-text-muted">
                      {item.hops === 0 ? "modified" : `${item.hops} hop${item.hops === 1 ? "" : "s"}`}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${riskTone[item.risk] || riskTone.low}`}>
                      {item.risk}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Test gaps + reviewers + surfaces */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SectionCard title="Test coverage gaps" tone="amber" items={data.test_coverage_gap} empty="No coverage gaps." />
        <SectionCard title="Recommended reviewers" tone="violet" items={data.recommended_reviewers} empty="No specific reviewers identified." />
        <SectionCard title="Deployment surfaces" tone="cyan" items={data.deployment_surfaces} empty="No deployment surfaces touched." />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. Onboarding Simulator — interactive 3-phase plan
// ─────────────────────────────────────────────────────────────────────
export function OnboardingSimResult({ data, repoId }: { data: OnboardingPlan; repoId: number }) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [openPhase, setOpenPhase] = useState<string>(data.phases[0]?.name || "");

  function toggleCheck(checkpointId: string) {
    const next = new Set(completed);
    const willBeChecked = !next.has(checkpointId);
    if (willBeChecked) next.add(checkpointId); else next.delete(checkpointId);
    setCompleted(next);
    // Persist progress — fire and forget; UI doesn't block on the call
    onboardingSim.updateProgress(repoId, checkpointId, willBeChecked).catch(() => {});
  }

  const phaseTitles: Record<string, string> = { day_1: "Day 1", week_1: "Week 1", month_1: "Month 1" };

  return (
    <div className="space-y-6">
      <div className="card-glass p-5">
        <p className="text-text-secondary text-sm leading-relaxed">{data.summary}</p>
        <div className="flex items-center gap-2 mt-3 flex-wrap text-xs text-text-muted">
          <span>Role: <span className="text-text-primary font-medium capitalize">{data.role}</span></span>
          <span>·</span>
          <span>Level: <span className="text-text-primary font-medium capitalize">{data.experience_level}</span></span>
        </div>
      </div>

      {/* Phases — accordion */}
      <div className="space-y-2">
        {data.phases.map(phase => {
          const isOpen = openPhase === phase.name;
          const phaseChecked = phase.checkpoints.filter(c => completed.has(c.id)).length;
          return (
            <div key={phase.name} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenPhase(isOpen ? "" : phase.name)}
                className="w-full p-4 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    phaseChecked === phase.checkpoints.length && phase.checkpoints.length > 0
                      ? "bg-emerald-subtle text-emerald border border-emerald/30"
                      : "bg-accent-subtle text-accent border border-accent/30"
                  }`}>
                    {phaseChecked}/{phase.checkpoints.length}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{phaseTitles[phase.name] || phase.title}</p>
                    <p className="text-xs text-text-muted truncate">{phase.goal}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider">{phase.estimated_hours}h</span>
                  <svg className={`w-4 h-4 text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-white/5 divide-y divide-white/5">
                  {phase.checkpoints.map(cp => (
                    <CheckpointRow key={cp.id} checkpoint={cp} checked={completed.has(cp.id)} onToggle={() => toggleCheck(cp.id)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Side info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Tech stack" tone="cyan" items={data.tech_stack} empty="—" />
        <SectionCard title="Key abstractions" tone="accent" items={data.key_abstractions} empty="—" />
        <SectionCard title="Watch out for" tone="amber" items={data.gotchas} empty="—" />
        <SectionCard title="People to meet" tone="violet" items={data.people_to_meet} empty="—" />
      </div>

      {/* First PR ideas */}
      {data.first_pr_suggestions.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">First PR suggestions</h3>
          <div className="space-y-2">
            {data.first_pr_suggestions.map((s, i) => (
              <div key={i} className="card p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{s.title}</p>
                    <p className="text-xs text-text-secondary mt-1">{s.why}</p>
                    {s.file && <code className="text-[10px] font-mono text-text-muted mt-1 block truncate">{s.file}</code>}
                  </div>
                  <span className="badge-blue text-[10px] capitalize shrink-0">{s.difficulty}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CheckpointRow({ checkpoint, checked, onToggle }: { checkpoint: OnboardingCheckpoint; checked: boolean; onToggle: () => void }) {
  return (
    <label className="p-3.5 flex items-start gap-3 cursor-pointer hover:bg-white/[0.02] transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className={`mt-0.5 w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-all ${
          checked ? "bg-emerald border-emerald" : "border-text-muted/40 hover:border-accent"
        }`}
        aria-label={checked ? "Mark incomplete" : "Mark complete"}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden="true">
            <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className={`font-medium text-sm ${checked ? "text-text-muted line-through" : "text-text-primary"}`}>
            {checkpoint.title}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-text-muted shrink-0">
            <span className="badge-gray capitalize">{checkpoint.kind}</span>
            <span>{checkpoint.estimated_minutes}m</span>
          </div>
        </div>
        <p className="text-xs text-text-secondary mt-1 leading-relaxed">{checkpoint.description}</p>
        {checkpoint.completion_hint && (
          <p className="text-[11px] text-text-muted mt-1.5 italic">→ {checkpoint.completion_hint}</p>
        )}
      </div>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3. Tribal Knowledge
// ─────────────────────────────────────────────────────────────────────
export function TribalKnowledgeResult({ data }: { data: TribalKnowledgeDump }) {
  const riskTone: Record<string, string> = {
    critical: "text-rose",
    high:     "text-amber",
    medium:   "text-accent",
    low:      "text-emerald",
  };

  return (
    <div className="space-y-6">
      <div className="card-glass p-5 space-y-2">
        <p className="text-text-secondary text-sm leading-relaxed">{data.summary}</p>
        {data.bus_factor_impact && (
          <div className="border-l-2 border-amber/40 pl-3 mt-3">
            <p className="text-xs text-amber font-semibold uppercase tracking-wider mb-1">Bus factor impact</p>
            <p className="text-xs text-text-secondary leading-relaxed">{data.bus_factor_impact}</p>
          </div>
        )}
      </div>

      {/* Owned areas */}
      {data.owned_areas.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Owned areas</h3>
          <div className="card divide-y divide-white/5 max-h-[300px] overflow-y-auto">
            {data.owned_areas.map((area, i) => (
              <div key={i} className="p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <code className="text-sm font-mono text-text-primary truncate min-w-0 flex-1">{area.path}</code>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-text-muted">{area.ownership_percent.toFixed(0)}% ownership</span>
                    <span className={`text-[10px] uppercase font-bold ${riskTone[area.risk_level] || riskTone.low}`}>{area.risk_level}</span>
                  </div>
                </div>
                <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{area.reason}</p>
                <div className="mt-2 h-1 bg-surface-overlay rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${area.ownership_percent > 75 ? "bg-rose" : area.ownership_percent > 50 ? "bg-amber" : "bg-emerald"}`}
                    style={{ width: `${Math.min(100, area.ownership_percent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Unique knowledge */}
      {data.unique_knowledge.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Unique knowledge</h3>
          <div className="space-y-3">
            {data.unique_knowledge.map((k, i) => (
              <div key={i} className="card p-4 space-y-2">
                <h4 className="font-semibold text-sm">{k.title}</h4>
                <p className="text-xs text-text-secondary leading-relaxed">{k.description}</p>
                {k.successor_briefing && (
                  <div className="border-l-2 border-violet/40 pl-3 py-1">
                    <p className="text-[10px] text-violet font-semibold uppercase tracking-wider mb-1">Successor briefing</p>
                    <p className="text-xs text-text-secondary leading-relaxed">{k.successor_briefing}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Decisions */}
      {data.decisions.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Architectural decisions</h3>
          <div className="space-y-3">
            {data.decisions.map((d, i) => (
              <div key={i} className="card p-4">
                <p className="text-xs text-text-muted uppercase tracking-wider font-semibold">Decision</p>
                <p className="font-semibold text-sm mt-0.5">{d.topic}</p>
                <p className="text-xs text-emerald mt-2">→ {d.choice_made}</p>
                <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{d.rationale}</p>
                {d.alternatives_considered.length > 0 && (
                  <p className="text-[10px] text-text-muted mt-2">
                    Alternatives: {d.alternatives_considered.join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Side bits */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Conventions introduced" tone="cyan" items={data.conventions_introduced} empty="—" />
        <SectionCard title="High-risk files" tone="rose" items={data.high_risk_files} empty="—" />
      </div>

      {data.recommended_handoff_meetings.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Recommended handoff meetings</h3>
          <div className="space-y-2">
            {data.recommended_handoff_meetings.map((m, i) => (
              <div key={i} className="card p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-sm font-medium">With: <span className="text-accent">{m.with}</span></p>
                  <span className="text-[10px] text-text-muted shrink-0">{m.duration_minutes} min</span>
                </div>
                <p className="text-xs text-text-secondary mt-1">Topics: {m.topics.join(", ")}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4. Dependency Health Radar
// ─────────────────────────────────────────────────────────────────────
export function DependencyRadarResult({ data }: { data: DependencyRadarReport }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Health summary */}
      <div className="card-glass p-5">
        <div className="flex items-center gap-5 flex-wrap">
          <div className="relative w-20 h-20 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-surface-border" />
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6"
                strokeDasharray={`${data.overall_health_score * 2.64} 264`}
                strokeLinecap="round"
                className={data.overall_health_score >= 70 ? "text-emerald" : data.overall_health_score >= 40 ? "text-amber" : "text-rose"} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold leading-none">{data.overall_health_score}</span>
              <span className="text-[9px] uppercase tracking-wider mt-0.5 text-text-muted">health</span>
            </div>
          </div>
          <p className="text-text-secondary text-sm leading-relaxed flex-1 min-w-[200px]">{data.summary}</p>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-5">
          <SeverityCount label="Critical" count={data.critical_count} tone="rose" />
          <SeverityCount label="High"     count={data.high_count}     tone="amber" />
          <SeverityCount label="Medium"   count={data.medium_count}   tone="accent" />
          <SeverityCount label="Low"      count={data.low_count}      tone="emerald" />
        </div>
      </div>

      {/* Findings */}
      {data.findings.length === 0 ? (
        <EmptyHint label="No dependencies analyzed yet." />
      ) : (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Findings <span className="font-normal text-text-muted/60">({data.findings.length})</span>
          </h3>
          <div className="space-y-2">
            {data.findings.map(f => (
              <DependencyCard
                key={f.name}
                finding={f}
                expanded={expanded === f.name}
                onToggle={() => setExpanded(expanded === f.name ? null : f.name)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DependencyCard({ finding: f, expanded, onToggle }: { finding: DependencyFinding; expanded: boolean; onToggle: () => void }) {
  const sevTone: Record<string, string> = {
    critical: "text-rose bg-rose-subtle border-rose/30",
    high:     "text-amber bg-amber-subtle border-amber/30",
    medium:   "text-accent bg-accent-subtle border-accent/30",
    low:      "text-emerald bg-emerald-subtle border-emerald/30",
  };
  const healthTone: Record<string, string> = {
    healthy:    "text-emerald",
    slowing:    "text-amber",
    stale:      "text-rose",
    abandoned:  "text-rose",
    unknown:    "text-text-muted",
  };
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-4 flex items-start gap-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-sm font-semibold">{f.name}</code>
            {f.current_version && <span className="text-xs text-text-muted">{f.current_version}</span>}
            <span className="text-[10px] text-text-muted uppercase tracking-wider">{f.ecosystem}</span>
          </div>
          <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{f.usage_surface}</p>
          <div className="flex items-center gap-3 mt-2 text-[11px]">
            <span className={`uppercase font-semibold ${healthTone[f.maintainer_health] || "text-text-muted"}`}>
              {f.maintainer_health}
            </span>
            {f.last_release_days_ago != null && (
              <span className="text-text-muted">last release {f.last_release_days_ago}d ago</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${sevTone[f.severity] || sevTone.low}`}>
            {f.severity}
          </span>
          <svg className={`w-4 h-4 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4 bg-white/[0.01]">
          {f.concerns.length > 0 && (
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">Concerns</p>
              <ul className="text-xs text-text-secondary space-y-1">
                {f.concerns.map((c, i) => <li key={i}>• {c}</li>)}
              </ul>
            </div>
          )}
          {f.alternatives.length > 0 && (
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">Alternatives</p>
              <div className="space-y-2">
                {f.alternatives.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <code className="font-mono font-semibold text-accent">{a.name}</code>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-text-muted">fit {a.fit_score}/100</span>
                        <span className="text-text-muted">·</span>
                        <span className="text-text-muted">{a.migration_effort_hours}h migration</span>
                      </div>
                      <p className="text-text-secondary mt-0.5">{a.reasons.join(" · ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {f.used_in_files.length > 0 && (
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">Used in</p>
              <div className="flex flex-wrap gap-1">
                {f.used_in_files.slice(0, 8).map((p, i) => (
                  <code key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-text-muted">{p}</code>
                ))}
                {f.used_in_files.length > 8 && <span className="text-[10px] text-text-muted">+{f.used_in_files.length - 8}</span>}
              </div>
            </div>
          )}
          <div className="border-l-2 border-accent/40 pl-3">
            <p className="text-[10px] text-accent uppercase tracking-wider font-semibold mb-0.5">
              Recommended action: {f.recommended_action.replace(/-/g, " ")}
            </p>
            <p className="text-xs text-text-secondary leading-relaxed">{f.recommended_action_reason}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityCount({ label, count, tone }: { label: string; count: number; tone: string }) {
  const colors: Record<string, string> = {
    rose:    "text-rose bg-rose-subtle border-rose/30",
    amber:   "text-amber bg-amber-subtle border-amber/30",
    accent:  "text-accent bg-accent-subtle border-accent/30",
    emerald: "text-emerald bg-emerald-subtle border-emerald/30",
  };
  return (
    <div className={`rounded-lg border p-2.5 text-center ${colors[tone]}`}>
      <p className="text-2xl font-bold leading-none">{count}</p>
      <p className="text-[10px] uppercase tracking-wider mt-1 font-semibold">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 5. Time Machine
// ─────────────────────────────────────────────────────────────────────
export function TimeMachineResult({ data }: { data: TimeMachineReport }) {
  const eventTone: Record<string, string> = {
    birth:            "text-emerald bg-emerald-subtle border-emerald/30",
    refactor:         "text-accent bg-accent-subtle border-accent/30",
    incident:         "text-rose bg-rose-subtle border-rose/30",
    "ownership-shift":"text-violet bg-violet-subtle border-violet/30",
    "major-feature":  "text-cyan bg-cyan-subtle border-cyan/30",
    deprecation:      "text-amber bg-amber-subtle border-amber/30",
  };

  // Find min/max for sparkline normalization
  const fileCounts = data.metric_series.map(m => m.file_count);
  const maxFiles = Math.max(...fileCounts, 1);

  return (
    <div className="space-y-6">
      <div className="card-glass p-5 space-y-3">
        <code className="text-xs text-text-muted">{data.path}</code>
        <p className="text-text-secondary text-sm leading-relaxed">{data.summary}</p>
        {data.narrative && (
          <div className="border-l-2 border-cyan/40 pl-3 mt-3">
            <p className="text-xs text-cyan font-semibold uppercase tracking-wider mb-1">The story</p>
            <p className="text-sm text-text-secondary leading-relaxed">{data.narrative}</p>
          </div>
        )}
      </div>

      {/* Activity over time — sparkline of commit counts per month */}
      {data.metric_series.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Commit activity over time</h3>
          <div className="card p-4">
            <svg viewBox="0 0 400 80" className="w-full h-20" preserveAspectRatio="none">
              <defs>
                <linearGradient id="tm-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c6bff" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#7c6bff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline
                fill="url(#tm-grad)"
                stroke="#7c6bff"
                strokeWidth="2"
                points={
                  // Top edge
                  data.metric_series.map((m, i) => {
                    const x = (i / Math.max(1, data.metric_series.length - 1)) * 400;
                    const y = 80 - (m.file_count / maxFiles) * 70;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(" ") +
                  // Close to baseline
                  ` 400,80 0,80`
                }
              />
            </svg>
            <div className="flex justify-between text-[10px] text-text-muted mt-2">
              <span>{data.metric_series[0]?.date}</span>
              <span>{data.metric_series[data.metric_series.length - 1]?.date}</span>
            </div>
          </div>
        </section>
      )}

      {/* Events timeline */}
      {data.events.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Notable events <span className="font-normal text-text-muted/60">({data.events.length})</span>
          </h3>
          <div className="space-y-3 relative pl-4">
            <div className="absolute left-1.5 top-2 bottom-2 w-px bg-white/10" aria-hidden="true" />
            {data.events.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e, i) => (
              <div key={i} className="relative">
                <div className="absolute -left-[18px] top-2 w-3 h-3 rounded-full bg-accent border-2 border-surface" aria-hidden="true" />
                <div className="card p-3.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${eventTone[e.kind] || eventTone.refactor}`}>
                          {e.kind.replace(/-/g, " ")}
                        </span>
                        <time className="text-xs text-text-muted">{e.date}</time>
                      </div>
                      <p className="font-semibold text-sm mt-1.5">{e.title}</p>
                      <p className="text-xs text-text-secondary mt-1 leading-relaxed">{e.description}</p>
                      {e.actors.length > 0 && (
                        <p className="text-[10px] text-text-muted mt-1.5">By: {e.actors.join(", ")}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Current risks */}
      <SectionCard title="Lessons for today" tone="amber" items={data.current_risks} empty="No historical risks identified." />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────
function SectionCard({ title, items, tone, empty }: { title: string; items: string[]; tone: string; empty: string }) {
  const toneText: Record<string, string> = {
    accent: "text-accent", violet: "text-violet", cyan: "text-cyan", emerald: "text-emerald", amber: "text-amber", rose: "text-rose",
  };
  return (
    <div className="card p-4">
      <p className={`text-[10px] uppercase tracking-wider font-bold ${toneText[tone]} mb-2`}>{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted italic">{empty}</p>
      ) : (
        <ul className="text-xs text-text-secondary space-y-1.5">
          {items.map((s, i) => <li key={i} className="leading-relaxed">• {s}</li>)}
        </ul>
      )}
    </div>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

/** Compact stat card — used inside Migration Plan summary, etc. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-xl font-bold tabular-nums leading-none">{value}</p>
      <p className="text-[10px] text-text-muted uppercase tracking-wider mt-1.5">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 6. License & IP Scanner
// ─────────────────────────────────────────────────────────────────────
import { LicenseScanReport, PRReview, licenseScanner, prReviewer } from "@/lib/api";

export function LicenseScannerResult({ data, repoId }: { data: LicenseScanReport; repoId: number }) {
  const sevTone: Record<string, string> = {
    critical: "text-rose bg-rose-subtle border-rose/30",
    high:     "text-amber bg-amber-subtle border-amber/30",
    medium:   "text-accent bg-accent-subtle border-accent/30",
    low:      "text-emerald bg-emerald-subtle border-emerald/30",
    info:     "text-text-muted bg-surface-overlay border-white/10",
  };

  const catLabel: Record<string, string> = {
    permissive:       "Permissive",
    weak_copyleft:    "Weak copyleft",
    strong_copyleft:  "Strong copyleft",
    network_copyleft: "Network copyleft",
    source_available: "Source-available",
    proprietary:      "Proprietary",
    unknown:          "Unknown",
  };

  function downloadSbom() {
    // Open SBOM in a new tab — backend returns JSON, browser will display or save
    window.open(licenseScanner.sbomUrl(repoId), "_blank");
  }

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="card-glass p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Project license</span>
              <span className="font-mono text-sm font-semibold">{data.project_license || "Not detected"}</span>
              {data.project_license_category !== "unknown" && (
                <span className="badge-blue text-[10px]">{catLabel[data.project_license_category]}</span>
              )}
            </div>
            <p className="text-text-secondary text-sm leading-relaxed">{data.summary}</p>
          </div>
          <button
            onClick={downloadSbom}
            type="button"
            className="btn-secondary text-xs shrink-0 inline-flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Download SPDX SBOM
          </button>
        </div>
      </div>

      {/* Severity grid */}
      <div className="grid grid-cols-5 gap-2">
        <SevCount label="Critical" count={data.counts_by_severity.critical || 0} tone="rose" />
        <SevCount label="High"     count={data.counts_by_severity.high || 0}     tone="amber" />
        <SevCount label="Medium"   count={data.counts_by_severity.medium || 0}   tone="accent" />
        <SevCount label="Low"      count={data.counts_by_severity.low || 0}      tone="emerald" />
        <SevCount label="Info"     count={data.counts_by_severity.info || 0}     tone="muted" />
      </div>

      {/* Findings — only show ones with concerns to focus attention */}
      {data.findings.length === 0 ? (
        <EmptyHint label="No dependencies found in this repository's manifests." />
      ) : (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Dependencies <span className="font-normal text-text-muted/60">({data.findings.length})</span>
          </h3>
          <div className="card divide-y divide-white/5 max-h-[500px] overflow-y-auto">
            {data.findings
              .slice()
              .sort((a, b) => {
                const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as Record<string, number>;
                return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
              })
              .map((f, i) => (
                <div key={i} className="p-3.5 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-sm font-semibold">{f.name}</code>
                        {f.version && <span className="text-xs text-text-muted">{f.version}</span>}
                        <span className="text-[10px] text-text-muted uppercase tracking-wider">{f.ecosystem}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-xs font-mono">{f.license || "Unknown"}</span>
                        {f.license_category !== "unknown" && (
                          <span className="text-[10px] text-text-muted">· {catLabel[f.license_category]}</span>
                        )}
                      </div>
                      {f.concerns.length > 0 && (
                        <ul className="text-xs text-text-secondary mt-2 space-y-1">
                          {f.concerns.map((c, j) => <li key={j}>• {c}</li>)}
                        </ul>
                      )}
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase shrink-0 ${sevTone[f.severity] || sevTone.info}`}>
                      {f.severity}
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

function SevCount({ label, count, tone }: { label: string; count: number; tone: string }) {
  const colors: Record<string, string> = {
    rose:    "text-rose bg-rose-subtle border-rose/30",
    amber:   "text-amber bg-amber-subtle border-amber/30",
    accent:  "text-accent bg-accent-subtle border-accent/30",
    emerald: "text-emerald bg-emerald-subtle border-emerald/30",
    muted:   "text-text-muted bg-surface-overlay border-white/10",
  };
  return (
    <div className={`rounded-lg border p-2.5 text-center ${colors[tone]}`}>
      <p className="text-2xl font-bold leading-none">{count}</p>
      <p className="text-[10px] uppercase tracking-wider mt-1 font-semibold">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 7. AI PR Reviewer — setup + manual review
// ─────────────────────────────────────────────────────────────────────
export function PRReviewerSetup({ repoId }: { repoId: number }) {
  const [prNumber, setPrNumber] = useState("");
  const [review, setReview] = useState<PRReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const webhookUrl = prReviewer.webhookUrl();

  async function runReview() {
    const n = parseInt(prNumber, 10);
    if (!n || n < 1) { setError("Enter a valid PR number"); return; }
    setError("");
    setLoading(true);
    setReview(null);
    try {
      const result = await prReviewer.review(repoId, n);
      setReview(result);
    } catch (err: any) {
      setError(err.message || "Review failed");
    } finally {
      setLoading(false);
    }
  }

  function copyWebhook() {
    navigator.clipboard?.writeText(webhookUrl);
  }

  return (
    <div className="space-y-6">
      {/* Setup instructions */}
      <div className="card-glass p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-sm mb-1">Auto-review every PR</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Add this webhook URL to your GitHub repository settings under <span className="font-mono text-text-primary">Settings → Webhooks → Add webhook</span>.
            Set the content type to <span className="font-mono text-text-primary">application/json</span> and select <span className="font-mono text-text-primary">Pull requests</span> events.
          </p>
        </div>
        <div className="bg-surface-overlay border border-white/10 rounded-lg p-3 flex items-center gap-2">
          <code className="text-xs font-mono flex-1 truncate text-text-primary">{webhookUrl}</code>
          <button onClick={copyWebhook} className="btn-secondary text-xs shrink-0">Copy</button>
        </div>
      </div>

      {/* Manual review */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-sm mb-1">Or review a PR manually</h3>
          <p className="text-xs text-text-secondary">Enter a PR number to run a review on demand. Useful for testing or for PRs from before you set up the webhook.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted font-mono text-sm">#</span>
          <input
            type="number"
            value={prNumber}
            onChange={e => setPrNumber(e.target.value)}
            placeholder="123"
            className="input flex-1 text-sm"
            min="1"
          />
          <button onClick={runReview} disabled={loading || !prNumber} className="btn-primary text-xs">
            {loading ? "Reviewing…" : "Run review"}
          </button>
        </div>
        {error && <p className="text-xs text-rose">{error}</p>}
      </div>

      {/* Review result */}
      {review && (
        <div className="space-y-4">
          <div className="card-glass p-5">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`inline-flex items-center px-2.5 py-1 rounded border text-[10px] font-bold uppercase ${
                review.risk_level === "critical" ? "text-rose bg-rose-subtle border-rose/30"
                : review.risk_level === "high" ? "text-amber bg-amber-subtle border-amber/30"
                : review.risk_level === "medium" ? "text-accent bg-accent-subtle border-accent/30"
                : "text-emerald bg-emerald-subtle border-emerald/30"
              }`}>
                {review.risk_level} · {review.risk_score}/100
              </span>
              <h4 className="font-semibold text-sm flex-1 min-w-0 truncate">PR #{review.pr_number}: {review.pr_title}</h4>
            </div>
            <p className="text-text-secondary text-sm mt-3 leading-relaxed">{review.summary}</p>
            <div className="grid grid-cols-3 gap-3 mt-4 text-center">
              <div className="card p-2.5">
                <p className="text-xl font-bold">{review.files_changed}</p>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Files changed</p>
              </div>
              <div className="card p-2.5">
                <p className="text-xl font-bold text-emerald">+{review.additions}</p>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Additions</p>
              </div>
              <div className="card p-2.5">
                <p className="text-xl font-bold text-rose">-{review.deletions}</p>
                <p className="text-[10px] text-text-muted uppercase tracking-wider">Deletions</p>
              </div>
            </div>
          </div>

          {review.affected_files.length > 0 && (
            <SectionCard title="Downstream affected" tone="accent" items={review.affected_files} empty="—" />
          )}
          {review.test_coverage_gap.length > 0 && (
            <SectionCard title="Missing test coverage" tone="amber" items={review.test_coverage_gap} empty="—" />
          )}
          {review.new_dependencies.length > 0 && (
            <SectionCard
              title="New dependencies"
              tone="rose"
              items={review.new_dependencies.map(d => `${d.name} ${d.version} (${d.ecosystem})`)}
              empty="—"
            />
          )}
          {review.deployment_surfaces.length > 0 && (
            <SectionCard title="Deployment surfaces touched" tone="cyan" items={review.deployment_surfaces} empty="—" />
          )}

          {/* Markdown preview */}
          <div>
            <h4 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-2">Comment that would be posted</h4>
            <pre className="card p-4 text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto">{review.review_comment}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 8. Compliance Reports — SOC 2 / GDPR / HIPAA
// ─────────────────────────────────────────────────────────────────────
import {
  ComplianceReport, ControlAssessment, GraphSearchResult, SymbolHit,
  compliance as complianceApi, knowledgeGraph,
} from "@/lib/api";

export function ComplianceSetup({ repoId }: { repoId: number }) {
  const [framework, setFramework] = useState<"soc2" | "gdpr" | "hipaa">("soc2");
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const result = await complianceApi.generate(repoId, framework);
      setReport(result);
    } catch (err: any) {
      setError(err.message || "Report generation failed");
    } finally {
      setLoading(false);
    }
  }

  if (report) {
    return <ComplianceReportView report={report} onReset={() => setReport(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="card-glass p-5 space-y-4">
        <p className="text-text-secondary text-sm leading-relaxed">
          Generate an evidence package mapping your codebase against a compliance framework's controls.
          Every claim is backed by a real file and line number from your repository.
        </p>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block mb-2">Framework</label>
          <div className="grid grid-cols-3 gap-2">
            {(["soc2", "gdpr", "hipaa"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFramework(f)}
                className={`p-3 rounded-lg border text-sm font-semibold transition-all ${
                  framework === f
                    ? "bg-accent-subtle border-accent text-accent"
                    : "bg-surface-overlay border-white/10 text-text-secondary hover:border-accent/30"
                }`}
              >
                {f === "soc2" ? "SOC 2" : f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="btn-primary w-full text-sm"
        >
          {loading ? "Scanning indexed files…" : `Generate ${framework.toUpperCase()} report`}
        </button>
        {error && <p className="text-xs text-rose">{error}</p>}
      </div>
    </div>
  );
}

function ComplianceReportView({ report, onReset }: { report: ComplianceReport; onReset: () => void }) {
  const statusTone: Record<string, string> = {
    evidence_found: "text-emerald bg-emerald-subtle border-emerald/30",
    partial:        "text-amber bg-amber-subtle border-amber/30",
    not_found:      "text-rose bg-rose-subtle border-rose/30",
    manual_review:  "text-violet bg-violet-subtle border-violet/30",
  };
  const statusLabel: Record<string, string> = {
    evidence_found: "Evidence found",
    partial:        "Partial",
    not_found:      "Not found",
    manual_review:  "Manual review",
  };
  const [openControl, setOpenControl] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Framework</p>
          <p className="font-bold text-base">{report.framework.toUpperCase()} <span className="text-xs text-text-muted font-normal">· {report.framework_version}</span></p>
        </div>
        <button onClick={onReset} className="btn-secondary text-xs">New report</button>
      </div>

      {/* Readiness ring */}
      <div className="card-glass p-5 flex items-center gap-5 flex-wrap">
        <div className="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-surface-border" />
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6"
              strokeDasharray={`${report.overall_readiness_score * 2.64} 264`}
              strokeLinecap="round"
              className={report.overall_readiness_score >= 70 ? "text-emerald" : report.overall_readiness_score >= 40 ? "text-amber" : "text-rose"}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold leading-none">{report.overall_readiness_score}</span>
            <span className="text-[9px] uppercase tracking-wider mt-0.5 text-text-muted">readiness</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-text-secondary text-sm leading-relaxed">{report.summary}</p>
          <div className="flex items-center gap-3 mt-3 text-xs text-text-muted">
            <span>{report.controls.length} controls</span>
            <span>·</span>
            <span>{report.evidence_total} evidence items</span>
            <span>·</span>
            <span>{report.files_scanned} files scanned</span>
          </div>
        </div>
      </div>

      {/* Controls list */}
      <section>
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Controls</h3>
        <div className="space-y-2">
          {report.controls.map(c => {
            const isOpen = openControl === c.control_id;
            return (
              <div key={c.control_id} className="card overflow-hidden">
                <button
                  onClick={() => setOpenControl(isOpen ? null : c.control_id)}
                  className="w-full p-3.5 flex items-start gap-3 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-[10px] font-mono text-text-muted">{c.control_id}</code>
                      <p className="font-semibold text-sm">{c.control_name}</p>
                    </div>
                    <p className="text-xs text-text-secondary mt-1">{c.summary}</p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase shrink-0 ${statusTone[c.status]}`}>
                    {statusLabel[c.status]}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-white/5 p-4 space-y-3 bg-white/[0.01]">
                    {c.recommendation && (
                      <div className="border-l-2 border-amber/40 pl-3">
                        <p className="text-[10px] text-amber uppercase tracking-wider font-semibold mb-1">Recommendation</p>
                        <p className="text-xs text-text-secondary">{c.recommendation}</p>
                      </div>
                    )}
                    {c.evidence.length > 0 && (
                      <div>
                        <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-2">Evidence ({c.evidence.length})</p>
                        <div className="space-y-2">
                          {c.evidence.map((e, i) => (
                            <div key={i} className="card p-2.5">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <code className="text-[11px] font-mono text-accent">{e.file_path}</code>
                                {e.line_number && <span className="text-[10px] text-text-muted">:{e.line_number}</span>}
                                <span className="text-[9px] text-text-muted uppercase">{e.pattern_id}</span>
                              </div>
                              <pre className="text-[10px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">{e.snippet}</pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="card border-amber/20 bg-amber/5 p-4">
        <p className="text-xs text-amber font-semibold uppercase tracking-wider mb-1">Disclaimer</p>
        <p className="text-xs text-text-secondary leading-relaxed">{report.disclaimer}</p>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// 9. Knowledge Graph Search
// ─────────────────────────────────────────────────────────────────────
export function KnowledgeGraphSearch({ repoId }: { repoId: number }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"auto" | "definitions" | "usages" | "concept">("auto");
  const [result, setResult] = useState<GraphSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await knowledgeGraph.search(repoId, query, mode);
      setResult(r);
    } catch (err: any) {
      setError(err.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const kindTone: Record<string, string> = {
    definition: "text-violet bg-violet-subtle border-violet/30",
    usage:      "text-accent bg-accent-subtle border-accent/30",
    import:     "text-cyan bg-cyan-subtle border-cyan/30",
    mention:    "text-text-muted bg-surface-overlay border-white/10",
  };

  return (
    <div className="space-y-5">
      {/* Query input */}
      <div className="card-glass p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
            placeholder='e.g. "where do we call Stripe", "User", "authentication flow"'
            className="input flex-1 text-sm"
            autoFocus
          />
          <button onClick={run} disabled={loading || !query.trim()} className="btn-primary text-sm">
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-text-muted">Mode:</span>
          {(["auto", "definitions", "usages", "concept"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded transition-colors ${
                mode === m ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-primary"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-rose">{error}</p>}
      </div>

      {result && (
        <>
          <div className="card-glass p-4">
            <p className="text-xs text-text-secondary leading-relaxed">{result.summary}</p>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted uppercase tracking-wider">
              <span>{result.total_hits} hits</span>
              <span>·</span>
              <span>{result.files_with_hits} files</span>
              <span>·</span>
              <span>mode: {result.mode_used}</span>
            </div>
          </div>

          {result.related_symbols.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.related_symbols.map(s => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); setMode("usages"); }}
                  className="text-[11px] font-mono px-2 py-0.5 rounded bg-accent-subtle text-accent hover:bg-accent/20 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {result.hits.length === 0 ? (
            <EmptyHint label="No matches found. Try a different mode or rephrase the query." />
          ) : (
            <div className="card divide-y divide-white/5 max-h-[500px] overflow-y-auto">
              {result.hits.map((h, i) => (
                <div key={i} className="p-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-1.5">
                    <div className="min-w-0 flex-1">
                      <code className="text-xs font-mono text-accent">{h.file_path}</code>
                      <span className="text-[10px] text-text-muted ml-2">:{h.line_number}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {h.language && <span className="text-[9px] text-text-muted uppercase">{h.language}</span>}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${kindTone[h.kind]}`}>
                        {h.kind}
                      </span>
                    </div>
                  </div>
                  <pre className="text-[11px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">{h.snippet}</pre>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 10. Code Drift Detection
// ─────────────────────────────────────────────────────────────────────
import {
  DriftReport, DriftViolation, ShiftCandidate, ShiftDetectionResult, ADRView,
  codeDrift, adrs as adrsApi,
} from "@/lib/api";

export function CodeDriftSetup({ repoId }: { repoId: number }) {
  const [filesText, setFilesText] = useState("");
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    const paths = filesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (paths.length === 0) { setError("Enter at least one file path"); return; }
    setError("");
    setLoading(true);
    setReport(null);
    try {
      const r = await codeDrift.check(repoId, paths);
      setReport(r);
    } catch (err: any) {
      setError(err.message || "Drift check failed");
    } finally {
      setLoading(false);
    }
  }

  const sevTone: Record<string, string> = {
    high:   "text-rose bg-rose-subtle border-rose/30",
    medium: "text-amber bg-amber-subtle border-amber/30",
    low:    "text-accent bg-accent-subtle border-accent/30",
    info:   "text-text-muted bg-surface-overlay border-white/10",
  };

  return (
    <div className="space-y-5">
      <div className="card-glass p-5 space-y-3">
        <p className="text-text-secondary text-sm leading-relaxed">
          Compare files against the patterns established in their peer set. Each violation cites real
          peer files showing the established convention.
        </p>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold block mb-2">
            File paths to analyze (one per line)
          </label>
          <textarea
            value={filesText}
            onChange={e => setFilesText(e.target.value)}
            placeholder="src/api/users.py&#10;src/api/billing.py"
            rows={5}
            className="input w-full text-sm font-mono"
          />
        </div>
        <button onClick={run} disabled={loading || !filesText.trim()} className="btn-primary w-full text-sm">
          {loading ? "Analyzing peer patterns…" : "Check for drift"}
        </button>
        {error && <p className="text-xs text-rose">{error}</p>}
      </div>

      {report && (
        <>
          <div className="card-glass p-5">
            <div className="flex items-center gap-5 flex-wrap">
              <div className="relative w-20 h-20 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-surface-border" />
                  <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6"
                    strokeDasharray={`${report.drift_score * 2.64} 264`}
                    strokeLinecap="round"
                    className={report.drift_score >= 50 ? "text-rose" : report.drift_score >= 25 ? "text-amber" : "text-emerald"}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold leading-none">{report.drift_score}</span>
                  <span className="text-[9px] uppercase tracking-wider mt-0.5 text-text-muted">drift</span>
                </div>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed flex-1 min-w-[200px]">{report.summary}</p>
            </div>
            <div className="text-xs text-text-muted mt-3">
              {report.files_analyzed} file(s) analyzed · {report.peer_set_size} peer files compared
            </div>
          </div>

          {report.violations.length === 0 ? (
            <EmptyHint label="No significant drift detected. Changes follow established patterns." />
          ) : (
            <div className="space-y-2">
              {report.violations.map((v, i) => (
                <div key={i} className="card p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                    <div className="min-w-0 flex-1">
                      <code className="text-xs font-mono text-accent">{v.file_path}</code>
                      <p className="font-semibold text-sm mt-1.5">{v.pattern_name}</p>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase shrink-0 ${sevTone[v.severity]}`}>
                      {v.severity}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">{v.description}</p>
                  {v.peer_examples.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">
                        Real peers showing the convention
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {v.peer_examples.map((p, j) => (
                          <code key={j} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay text-text-muted">
                            {p}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                  {v.suggested_fix && (
                    <p className="text-xs text-accent mt-2 italic">→ {v.suggested_fix}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// 11. Living ADRs
// ─────────────────────────────────────────────────────────────────────
export function ADRsSetup({ repoId }: { repoId: number }) {
  const [shifts, setShifts] = useState<ShiftCandidate[] | null>(null);
  const [existing, setExisting] = useState<ADRView[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null); // candidate title
  const [error, setError] = useState("");

  // Load existing ADRs immediately so users see what's already documented
  useEffect(() => {
    adrsApi.list(repoId).then(setExisting).catch(() => {});
  }, [repoId]);

  async function detect() {
    setLoading(true);
    setError("");
    try {
      const r = await adrsApi.detect(repoId, 6);
      setShifts(r.candidates);
    } catch (err: any) {
      setError(err.message || "Detection failed");
    } finally {
      setLoading(false);
    }
  }

  async function draftAndCreate(candidate: ShiftCandidate) {
    setDrafting(candidate.title);
    try {
      const draft = await adrsApi.draft(repoId, candidate);
      // Auto-create as "proposed" — user can edit later in the ADR view
      const created = await adrsApi.create({
        repository_id: repoId,
        title: draft.title,
        context: draft.context,
        decision: draft.decision,
        consequences: draft.consequences,
        alternatives: draft.alternatives,
        status: "proposed",
        detection_kind: candidate.kind,
        evidence: draft.evidence,
      });
      setExisting(prev => [created, ...prev]);
      // Remove from candidate list
      setShifts(prev => prev?.filter(s => s.title !== candidate.title) || null);
    } catch (err: any) {
      setError(err.message || "Could not draft ADR");
    } finally {
      setDrafting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card-glass p-5 space-y-3">
        <p className="text-text-secondary text-sm leading-relaxed">
          Living ADRs auto-detect architectural shifts in your real git history — library swaps, API style changes —
          and prompt you to document them while the context is still fresh.
        </p>
        <button onClick={detect} disabled={loading} className="btn-primary text-sm">
          {loading ? "Scanning recent commits…" : "Detect architectural shifts"}
        </button>
        {error && <p className="text-xs text-rose">{error}</p>}
      </div>

      {shifts && shifts.length === 0 && (
        <EmptyHint label="No architectural shifts detected in the last 6 months." />
      )}

      {shifts && shifts.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Detected shifts ({shifts.length})
          </h3>
          <div className="space-y-2">
            {shifts.map((c, i) => (
              <div key={i} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{c.title}</p>
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">{c.description}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap text-[10px] text-text-muted">
                      <span>Detected {c.detected_at}</span>
                      <span>·</span>
                      <span>{c.confidence}% confidence</span>
                      {c.evidence_commits.length > 0 && (
                        <>
                          <span>·</span>
                          <span>commit {c.evidence_commits[0]}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => draftAndCreate(c)}
                    disabled={drafting === c.title}
                    className="btn-secondary text-xs shrink-0"
                  >
                    {drafting === c.title ? "Drafting…" : "Draft ADR"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {existing.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Documented decisions ({existing.length})
          </h3>
          <div className="space-y-2">
            {existing.map(a => <ADRCard key={a.id} adr={a} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function ADRCard({ adr }: { adr: ADRView }) {
  const [open, setOpen] = useState(false);
  const statusTone: Record<string, string> = {
    proposed:   "text-amber bg-amber-subtle border-amber/30",
    accepted:   "text-emerald bg-emerald-subtle border-emerald/30",
    superseded: "text-text-muted bg-surface-overlay border-white/10",
    deprecated: "text-rose bg-rose-subtle border-rose/30",
  };
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-3.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm">{adr.title}</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              {new Date(adr.created_at).toLocaleDateString()}
              {adr.detection_kind && adr.detection_kind !== "manual" && ` · auto-detected (${adr.detection_kind})`}
            </p>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase shrink-0 ${statusTone[adr.status] || statusTone.proposed}`}>
            {adr.status}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-white/5 p-4 space-y-3 bg-white/[0.01]">
          {adr.context && (
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1">Context</p>
              <p className="text-xs text-text-secondary leading-relaxed">{adr.context}</p>
            </div>
          )}
          {adr.decision && (
            <div>
              <p className="text-[10px] text-emerald uppercase tracking-wider font-semibold mb-1">Decision</p>
              <p className="text-xs text-text-secondary leading-relaxed">{adr.decision}</p>
            </div>
          )}
          {adr.consequences && (
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1">Consequences</p>
              <p className="text-xs text-text-secondary leading-relaxed">{adr.consequences}</p>
            </div>
          )}
          {adr.alternatives.length > 0 && (
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1">Alternatives considered</p>
              <p className="text-xs text-text-secondary">{adr.alternatives.join(" · ")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 12. Cost Forecaster
// ─────────────────────────────────────────────────────────────────────
import { CostForecast, CostLineItem, costForecaster } from "@/lib/api";

export function CostForecasterResult({ data }: { data: CostForecast }) {
  const hasProposed = data.line_items_proposed.length > 0;
  const deltaTone = data.delta_monthly > 0
    ? "text-rose"
    : data.delta_monthly < 0
      ? "text-emerald"
      : "text-text-muted";

  return (
    <div className="space-y-6">
      {/* Headline */}
      <div className="card-glass p-5 space-y-3">
        <p className="text-text-secondary text-sm leading-relaxed">{data.summary}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <CostStat label="Current /mo" value={`$${data.current_monthly_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          {hasProposed && (
            <CostStat label="Proposed /mo" value={`$${data.proposed_monthly_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          )}
          {hasProposed && (
            <div className="card p-3 text-center">
              <p className={`text-2xl font-bold ${deltaTone}`}>
                {data.delta_monthly >= 0 ? "+" : ""}${data.delta_monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mt-1">
                Delta {data.delta_pct != null && `(${data.delta_pct >= 0 ? "+" : ""}${data.delta_pct.toFixed(1)}%)`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Catalog disclaimer — important for honesty */}
      <div className="card border-amber/20 bg-amber/5 p-3.5">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-amber shrink-0 mt-0.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6v4M10 14h.01" strokeLinecap="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-amber font-semibold mb-0.5">List prices · Catalog {data.catalog_version}</p>
            <p className="text-[11px] text-text-secondary leading-relaxed">{data.catalog_note}</p>
          </div>
        </div>
      </div>

      {/* Line items */}
      {data.line_items_current.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Current resources <span className="font-normal text-text-muted/60">({data.line_items_current.length})</span>
          </h3>
          <CostTable items={data.line_items_current} />
        </section>
      )}

      {hasProposed && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Proposed resources <span className="font-normal text-text-muted/60">({data.line_items_proposed.length})</span>
          </h3>
          <CostTable items={data.line_items_proposed} />
        </section>
      )}

      {data.unmatched_resources.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Could not price <span className="font-normal text-text-muted/60">({data.unmatched_resources.length})</span>
          </h3>
          <div className="card p-3.5">
            <p className="text-xs text-text-muted mb-2">
              These resources were detected but couldn't be matched to the price catalog. They may need manual estimation.
            </p>
            <ul className="text-xs text-text-secondary space-y-1 font-mono">
              {data.unmatched_resources.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

function CostStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-text-muted uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}

function CostTable({ items }: { items: CostLineItem[] }) {
  return (
    <div className="card divide-y divide-white/5 max-h-[400px] overflow-y-auto">
      {items.map((it, i) => (
        <div key={i} className="p-3.5 hover:bg-white/[0.02] transition-colors">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-sm font-mono font-semibold">{it.resource_name}</code>
                <span className="text-[10px] text-text-muted uppercase tracking-wider">{it.resource_type}</span>
                {it.instance_type && <span className="text-[11px] font-mono text-accent">{it.instance_type}</span>}
                {it.quantity > 1 && <span className="text-[10px] text-text-muted">× {it.quantity}</span>}
              </div>
              <code className="text-[10px] font-mono text-text-muted block mt-0.5">{it.file_path}</code>
              {it.notes.length > 0 && (
                <ul className="text-[10px] text-text-muted mt-1 space-y-0.5">
                  {it.notes.map((n, j) => <li key={j}>· {n}</li>)}
                </ul>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold tabular-nums">
                ${it.total_cost_monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-text-muted">/month</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 13. Migration Assistant
// ─────────────────────────────────────────────────────────────────────
import { AvailableMigration, MigrationPlan, MigrationPhase, FilePlan, migrationAssistant } from "@/lib/api";

export function MigrationAssistantSetup({ repoId }: { repoId: number }) {
  const [available, setAvailable] = useState<AvailableMigration[] | null>(null);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Auto-run detection on mount — saves a click
  useEffect(() => {
    setLoading(true);
    migrationAssistant.detect(repoId)
      .then(r => setAvailable(r.available_migrations))
      .catch((err: any) => setError(err.message || "Detection failed"))
      .finally(() => setLoading(false));
  }, [repoId]);

  async function buildPlan(recipeId: string) {
    setPlanning(recipeId);
    setError("");
    try {
      const p = await migrationAssistant.plan(repoId, recipeId);
      setPlan(p);
    } catch (err: any) {
      setError(err.message || "Plan generation failed");
    } finally {
      setPlanning(null);
    }
  }

  if (plan) {
    return <MigrationPlanView plan={plan} onBack={() => setPlan(null)} />;
  }

  return (
    <div className="space-y-6">
      <div className="card-glass p-5">
        <p className="text-text-secondary text-sm leading-relaxed">
          We detected which migrations apply to this codebase by scanning real manifests and import statements.
          Pick one to generate a phased plan with file-by-file complexity scoring.
        </p>
      </div>

      {error && <p className="text-xs text-rose">{error}</p>}

      {loading && (
        <div className="card p-6 text-center">
          <p className="text-sm text-text-muted">Scanning indexed files for migration candidates…</p>
        </div>
      )}

      {available && available.length === 0 && (
        <EmptyHint label="No applicable migrations detected. The recipe library may not yet cover the technologies in this repo." />
      )}

      {available && available.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">
            Applicable migrations ({available.length})
          </h3>
          <div className="space-y-2">
            {available.map(m => (
              <div key={m.recipe_id} className="card p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{m.name}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {m.files_affected} files affected · ~{m.estimated_hours_total}h estimated effort
                    </p>
                  </div>
                  <button
                    onClick={() => buildPlan(m.recipe_id)}
                    disabled={planning === m.recipe_id}
                    className="btn-primary text-xs shrink-0"
                  >
                    {planning === m.recipe_id ? "Building plan…" : "Build plan"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MigrationPlanView({ plan, onBack }: { plan: MigrationPlan; onBack: () => void }) {
  const complexityTone: Record<string, string> = {
    trivial:  "text-emerald bg-emerald-subtle border-emerald/30",
    standard: "text-accent bg-accent-subtle border-accent/30",
    complex:  "text-amber bg-amber-subtle border-amber/30",
    manual:   "text-rose bg-rose-subtle border-rose/30",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Migration plan</p>
          <p className="font-bold text-base">{plan.recipe_name}</p>
        </div>
        <button onClick={onBack} className="btn-secondary text-xs">← Back to migrations</button>
      </div>

      {/* Summary header */}
      <div className="card-glass p-5">
        <p className="text-text-secondary text-sm leading-relaxed">{plan.summary}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Stat label="Files" value={String(plan.total_files)} />
          <Stat label="Est. hours" value={String(plan.estimated_hours_total)} />
          <Stat label="Phases" value={String(plan.phases.length)} />
          <Stat label="Manual" value={String(plan.complexity_breakdown.manual || 0)} />
        </div>
      </div>

      {/* Complexity breakdown */}
      <div className="grid grid-cols-4 gap-2">
        {(["trivial", "standard", "complex", "manual"] as const).map(k => (
          <div key={k} className={`rounded-lg border p-2.5 text-center ${complexityTone[k]}`}>
            <p className="text-2xl font-bold leading-none">{plan.complexity_breakdown[k] || 0}</p>
            <p className="text-[10px] uppercase tracking-wider mt-1 font-semibold">{k}</p>
          </div>
        ))}
      </div>

      {/* Phases */}
      {plan.phases.map((phase, i) => (
        <PhaseSection key={i} phase={phase} />
      ))}

      {/* Risks */}
      {plan.risks.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Risks</h3>
          <div className="card p-4 space-y-1.5">
            {plan.risks.map((r, i) => (
              <p key={i} className="text-xs text-text-secondary">⚠ {r}</p>
            ))}
          </div>
        </section>
      )}

      {/* Rollback */}
      {plan.rollback_strategy && (
        <section>
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">Rollback strategy</h3>
          <div className="card border-emerald/20 bg-emerald/5 p-4">
            <p className="text-xs text-text-secondary leading-relaxed">{plan.rollback_strategy}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function PhaseSection({ phase }: { phase: MigrationPhase }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-semibold text-sm">{phase.name}</h3>
        <p className="text-xs text-text-muted mt-0.5">{phase.description}</p>
        <p className="text-[10px] text-text-muted mt-1">{phase.files.length} files · ~{phase.estimated_hours}h</p>
      </div>
      <div className="card divide-y divide-white/5 max-h-[400px] overflow-y-auto">
        {phase.files.map((fp) => {
          const isOpen = expanded === fp.file_path;
          const complexityTone: Record<string, string> = {
            trivial:  "text-emerald bg-emerald-subtle border-emerald/30",
            standard: "text-accent bg-accent-subtle border-accent/30",
            complex:  "text-amber bg-amber-subtle border-amber/30",
            manual:   "text-rose bg-rose-subtle border-rose/30",
          };
          return (
            <div key={fp.file_path}>
              <button
                onClick={() => setExpanded(isOpen ? null : fp.file_path)}
                className="w-full p-3 flex items-start gap-3 text-left hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono text-text-primary">{fp.file_path}</code>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {fp.matches} match(es) · ~{fp.estimated_minutes}m
                  </p>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase shrink-0 ${complexityTone[fp.complexity]}`}>
                  {fp.complexity}
                </span>
              </button>
              {isOpen && fp.sample_findings.length > 0 && (
                <div className="border-t border-white/5 p-3 bg-white/[0.01] space-y-2">
                  {fp.sample_findings.map((f, j) => (
                    <div key={j} className="text-xs space-y-0.5">
                      <p className="text-[10px] text-text-muted">Line {f.line}</p>
                      <code className="block text-[11px] font-mono bg-surface-overlay p-1.5 rounded text-text-secondary">
                        {f.matched_text}
                      </code>
                      <p className="text-[11px] text-accent leading-relaxed">→ {f.fix}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
