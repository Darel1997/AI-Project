"use client";

import { useEffect, ReactNode } from "react";

/**
 * FeaturePanel — slide-in side panel from the right edge, used by all 5
 * unique-feature result views (Blast Radius, Onboarding Simulator, Tribal
 * Knowledge, Dependency Radar, Time Machine).
 *
 * Wider than ConfirmDialog (max-w-3xl vs max-w-md) because these panels render
 * dense data (tables, accordions, charts). ESC closes. Click outside closes.
 * Body scroll is locked while open.
 */
export function FeaturePanel({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  loading = false,
  loadingLabel = "Working on it…",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: { label: string; tone: "accent" | "violet" | "cyan" | "emerald" | "amber" | "rose" };
  children: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
}) {
  // Lock background scroll + ESC to close while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const toneClasses: Record<string, string> = {
    accent:  "bg-accent-subtle text-accent border-accent/30",
    violet:  "bg-violet-subtle text-violet border-violet/30",
    cyan:    "bg-cyan-subtle text-cyan border-cyan/30",
    emerald: "bg-emerald-subtle text-emerald border-emerald/30",
    amber:   "bg-amber-subtle text-amber border-amber/30",
    rose:    "bg-rose-subtle text-rose border-rose/30",
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in" role="dialog" aria-modal="true" aria-label={title}>
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="flex-1 bg-black/50 backdrop-blur-sm"
      />
      {/* Panel */}
      <div className="w-full max-w-3xl bg-surface border-l border-white/5 shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              {badge && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] uppercase tracking-wider font-bold ${toneClasses[badge.tone]}`}>
                  {badge.label}
                </span>
              )}
              <h2 className="text-lg font-bold truncate">{title}</h2>
            </div>
            {subtitle && <p className="text-text-secondary text-sm mt-1 line-clamp-2">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            type="button"
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-md inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <PanelLoading label={loadingLabel} /> : children}
        </div>
      </div>
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full bg-accent/10 animate-ping" />
        <div className="absolute inset-0 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-muted mt-1">This usually takes 5-15 seconds</p>
      </div>
    </div>
  );
}
