/**
 * featureMeta — central registry mapping every feature slug to:
 *   1. an original SVG icon (drawn here, no copies of upstream brand logos)
 *   2. a behaviour `kind` so the toolbar can hint at what will happen on click
 *   3. an accent tone keyed off the feature's character
 *
 * Every feature shipped in the catalog (`feature_gate.py`) MUST have an entry
 * here. The toolbar falls back to a neutral icon if a slug is missing, but
 * that's a bug — add it here.
 *
 * Why a behaviour kind?
 *   The toolbar previously rendered every feature as the same generic pill,
 *   even though some open a tab, some pop a panel that runs immediately, and
 *   some pop a panel asking for input first. Users couldn't tell which would
 *   happen until they clicked. The `kind` drives a small affordance on each
 *   button so the row reads as three groups instead of a wall of identical pills.
 *
 *   - "tab"           → Run analysis, then switch tabs to show the result.
 *                       Affordance: a small right-arrow chevron.
 *   - "panel-execute" → Open a side panel and execute immediately, no input.
 *                       Affordance: a "play" triangle, suggesting "runs now".
 *   - "panel-setup"   → Open a side panel that asks for input first.
 *                       Affordance: a small sliders glyph, suggesting "configure".
 *   - "navigate"      → Plain navigation to another page (e.g. /chat).
 *                       Affordance: an external-link arrow.
 */

import React from "react";

export type FeatureKind = "tab" | "panel-execute" | "panel-setup" | "navigate";
export type FeatureTone = "accent" | "violet" | "cyan" | "emerald" | "amber" | "rose";

export interface FeatureMeta {
  /** Matches the catalog slug from feature_gate.py */
  slug: string;
  /** Original 16×16 SVG, hand-drawn for this feature. */
  Icon: ({ className }: { className?: string }) => JSX.Element;
  /** Behaviour bucket — drives the affordance shown on the button. */
  kind: FeatureKind;
  /** Tonal accent so similar features cluster visually. */
  tone: FeatureTone;
}

/* ───────────────────────────────────────────────────────────────────
   Affordance icons (1 per FeatureKind) — small glyph that hints at
   what will happen on click.
   ─────────────────────────────────────────────────────────────────── */

export function KindAffordance({ kind, className = "w-3 h-3" }: { kind: FeatureKind; className?: string }) {
  switch (kind) {
    case "tab":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 3l5 5-5 5" />
        </svg>
      );
    case "panel-execute":
      return (
        // Filled play triangle — "runs immediately"
        <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M5 3.5v9a0.5 0.5 0 00.77.42l7-4.5a0.5 0.5 0 000-.84l-7-4.5A0.5 0.5 0 005 3.5z" />
        </svg>
      );
    case "panel-setup":
      return (
        // Sliders — "configure first"
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          <path d="M3 4h7M13 4h0.01" />
          <path d="M3 12h3M9 12h4" />
          <circle cx="11" cy="4" r="1.5" />
          <circle cx="7" cy="12" r="1.5" />
        </svg>
      );
    case "navigate":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 3h4v4M13 3l-7 7M11 9v3a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1h3" />
        </svg>
      );
  }
}

export function affordanceLabel(kind: FeatureKind): string {
  switch (kind) {
    case "tab":           return "Opens in a tab";
    case "panel-execute": return "Runs in a side panel";
    case "panel-setup":   return "Configure, then run";
    case "navigate":      return "Opens a new page";
  }
}

/* ───────────────────────────────────────────────────────────────────
   Feature icons — every feature gets its OWN original SVG.
   Common icon contract: 16×16 viewBox, `currentColor` strokes,
   stroke-width 1.6–2 for visual cohesion across the row.
   ─────────────────────────────────────────────────────────────────── */

// Chat — speech bubble with three dots.
const IconChat = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H7l-3 3v-3H4a2 2 0 01-2-2V4z" />
    <circle cx="6" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="8" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="10" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

// Documentation — paper with folded corner and 3 lines of text.
const IconDocs = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
    <path d="M9 2v4h4" />
    <path d="M5 9h6M5 11.5h4" strokeLinecap="round" />
  </svg>
);

// Architecture diagram — three connected nodes.
const IconArchitecture = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="1.5" width="4" height="3" rx="0.5" />
    <rect x="1.5" y="11" width="4" height="3" rx="0.5" />
    <rect x="10.5" y="11" width="4" height="3" rx="0.5" />
    <path d="M8 4.5v3M8 7.5l-4.5 3.5M8 7.5l4.5 3.5" />
  </svg>
);

// Onboarding guide — open book.
const IconOnboardingGuide = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 3.5h4.5a1.5 1.5 0 011.5 1.5v8a1 1 0 00-1-1H2v-8.5z" />
    <path d="M14 3.5H9.5A1.5 1.5 0 008 5v8a1 1 0 011-1h5v-8.5z" />
  </svg>
);

// License scanner — paper with seal/circle stamp.
const IconLicense = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 2h7l3 3v7.5a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
    <circle cx="10.5" cy="10" r="2.2" />
    <path d="M10.5 12.2v2.3l-1-1-1 1v-2.3" strokeLinejoin="round" />
  </svg>
);

// Security audit — shield with checkmark.
const IconSecurity = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 1.5l5.5 2v4.5c0 3.5-2.5 5.5-5.5 6.5C5 13.5 2.5 11.5 2.5 8V3.5L8 1.5z" />
    <path d="M5.5 8l2 2 3.5-4" strokeLinecap="round" />
  </svg>
);

// Code quality — magnifier over code brackets.
const IconCodeQuality = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M11 11l3 3" strokeLinecap="round" />
    <path d="M5.5 5.5l-1 1.5 1 1.5M8.5 5.5l1 1.5-1 1.5" strokeLinecap="round" />
  </svg>
);

// Task generator — checklist clipboard.
const IconTasks = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="2.5" width="10" height="12" rx="1" />
    <rect x="6" y="1.5" width="4" height="2.5" rx="0.5" fill="currentColor" stroke="currentColor" />
    <path d="M5.5 7l1 1 2-2.5M5.5 11l1 1 2-2.5" strokeLinecap="round" stroke="white" strokeWidth="1.6" />
    <path d="M5.5 7l1 1 2-2.5M5.5 11l1 1 2-2.5" strokeLinecap="round" />
  </svg>
);

// Dependency radar — concentric ovals like a radar sweep.
const IconDependencyRadar = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" />
    <ellipse cx="8" cy="8" rx="6.5" ry="2.5" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6.5" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

// Time machine — clock with curved arrow going backwards.
const IconTimeMachine = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 8a5.5 5.5 0 109.5-3.8" strokeLinecap="round" />
    <path d="M2.5 3v3h3" strokeLinecap="round" />
    <path d="M8 5.5v3l2 1.5" strokeLinecap="round" />
  </svg>
);

// Cost forecaster — line chart climbing with a $ glyph.
const IconCost = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M2 13l4-4 3 2 5-6" />
    <path d="M9 4h4v4" />
    <text x="3.5" y="6" fontSize="3.6" fontWeight="700" fill="currentColor" stroke="none">$</text>
  </svg>
);

// Onboarding simulator — calendar with phases (Day 1 / Week 1 / Month 1).
const IconOnboardingSim = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="12" height="11" rx="1" />
    <path d="M2 6h12" />
    <path d="M5 1.5v3M11 1.5v3" strokeLinecap="round" />
    <rect x="4" y="8" width="2" height="2" rx="0.3" fill="currentColor" stroke="none" />
    <rect x="7" y="8" width="2" height="2" rx="0.3" fill="currentColor" stroke="none" opacity="0.6" />
    <rect x="10" y="8" width="2" height="2" rx="0.3" fill="currentColor" stroke="none" opacity="0.3" />
  </svg>
);

// Blast radius — center dot with two ripple rings.
const IconBlastRadius = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="3.7" strokeDasharray="1.6 1.6" />
    <circle cx="8" cy="8" r="6.2" strokeDasharray="1.6 1.6" opacity="0.5" />
  </svg>
);

// AI PR reviewer — git branch merge + sparkle.
const IconPRReviewer = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <circle cx="4" cy="3.5" r="1.4" />
    <circle cx="4" cy="12.5" r="1.4" />
    <circle cx="11.5" cy="8" r="1.4" />
    <path d="M4 5v6" />
    <path d="M5.4 4c4 0 4.6 3.5 4.6 4" strokeLinecap="round" />
    <path d="M13.5 3l0.5 1L15 4.5l-1 0.5-0.5 1-0.5-1L12 4.5l1-0.5z" fill="currentColor" stroke="none" />
  </svg>
);

// Knowledge graph — three nodes connected to a central node.
const IconKnowledgeGraph = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="8" r="2" />
    <circle cx="2.5" cy="3" r="1.4" />
    <circle cx="13.5" cy="3" r="1.4" />
    <circle cx="8" cy="14" r="1.4" />
    <path d="M3.5 4l3 3M12.5 4l-3 3M8 10v2.5" />
  </svg>
);

// Code drift detection — two waves with a divergence flag.
const IconCodeDrift = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M1.5 6c2-2 4 2 6 0s4-2 6 0" />
    <path d="M1.5 11c2-2 4 0 6-2 1.5-1.5 4 0 6-2" />
    <path d="M11.5 1.5l1.5 1.5-1.5 1.5z" fill="currentColor" stroke="none" />
  </svg>
);

// Living ADRs (Architectural Decision Records) — pillar with heartbeat line.
const IconADRs = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M3 2h2v12H3zM11 2h2v12h-2z" />
    <path d="M5 8h1.5l1-2 1 4 1-2H11" />
  </svg>
);

// Migration assistant — two boxes with an arrow between them.
const IconMigration = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <rect x="1.5" y="4" width="4.5" height="8" rx="0.5" />
    <rect x="10" y="4" width="4.5" height="8" rx="0.5" opacity="0.5" />
    <path d="M6.5 8h3.5" />
    <path d="M8.5 6.5L10 8 8.5 9.5" />
  </svg>
);

// Tribal knowledge — lightbulb with rays radiating out.
const IconTribalKnowledge = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M8 2a4 4 0 013 6.6c-0.6 0.7-1 1.3-1 2.1H6c0-0.8-0.4-1.4-1-2.1A4 4 0 018 2z" />
    <path d="M6.5 13h3M7 14.5h2" />
    <path d="M2 7h1M13 7h1M3 3l0.7 0.7M12.3 3.7L13 3" />
  </svg>
);

// Compliance reports — clipboard with shield watermark.
const IconCompliance = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="2.5" width="10" height="12" rx="1" />
    <rect x="6" y="1.5" width="4" height="2.5" rx="0.5" fill="currentColor" stroke="currentColor" />
    <path d="M8 7l-2 1v2c0 1.5 1 2.3 2 2.8 1-0.5 2-1.3 2-2.8V8l-2-1z" />
  </svg>
);

// Cross-repo intelligence — two stacked rectangles overlapping (set theory).
const IconCrossRepo = ({ className = "w-3.5 h-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="8" r="4" />
    <circle cx="10" cy="8" r="4" />
  </svg>
);

/* ───────────────────────────────────────────────────────────────────
   The registry
   ─────────────────────────────────────────────────────────────────── */

export const FEATURE_META: Record<string, FeatureMeta> = {
  // Free tier
  chat:                { slug: "chat",                Icon: IconChat,             kind: "navigate",      tone: "accent"  },
  documentation:       { slug: "documentation",       Icon: IconDocs,             kind: "tab",           tone: "cyan"    },
  architecture:        { slug: "architecture",        Icon: IconArchitecture,     kind: "tab",           tone: "violet"  },
  onboarding_guide:    { slug: "onboarding_guide",    Icon: IconOnboardingGuide,  kind: "tab",           tone: "emerald" },
  license_scanner:     { slug: "license_scanner",     Icon: IconLicense,          kind: "panel-execute", tone: "amber"   },
  // Pro
  security_audit:      { slug: "security_audit",      Icon: IconSecurity,         kind: "tab",           tone: "rose"    },
  code_quality:        { slug: "code_quality",        Icon: IconCodeQuality,      kind: "tab",           tone: "amber"   },
  task_generator:      { slug: "task_generator",      Icon: IconTasks,            kind: "tab",           tone: "accent"  },
  dependency_radar:    { slug: "dependency_radar",    Icon: IconDependencyRadar,  kind: "panel-execute", tone: "cyan"    },
  time_machine:        { slug: "time_machine",        Icon: IconTimeMachine,      kind: "panel-execute", tone: "violet"  },
  cost_forecaster:     { slug: "cost_forecaster",     Icon: IconCost,             kind: "panel-execute", tone: "emerald" },
  // Team
  onboarding_sim:      { slug: "onboarding_sim",      Icon: IconOnboardingSim,    kind: "panel-execute", tone: "emerald" },
  blast_radius:        { slug: "blast_radius",        Icon: IconBlastRadius,      kind: "panel-execute", tone: "rose"    },
  pr_reviewer:         { slug: "pr_reviewer",         Icon: IconPRReviewer,       kind: "panel-setup",   tone: "violet"  },
  knowledge_graph:     { slug: "knowledge_graph",     Icon: IconKnowledgeGraph,   kind: "panel-setup",   tone: "cyan"    },
  code_drift:          { slug: "code_drift",          Icon: IconCodeDrift,        kind: "panel-setup",   tone: "amber"   },
  adrs:                { slug: "adrs",                Icon: IconADRs,             kind: "panel-setup",   tone: "violet"  },
  migration_assistant: { slug: "migration_assistant", Icon: IconMigration,        kind: "panel-setup",   tone: "accent"  },
  // Business
  tribal_knowledge:    { slug: "tribal_knowledge",    Icon: IconTribalKnowledge,  kind: "panel-execute", tone: "amber"   },
  compliance:          { slug: "compliance",          Icon: IconCompliance,       kind: "panel-setup",   tone: "emerald" },
  cross_repo:          { slug: "cross_repo",          Icon: IconCrossRepo,        kind: "panel-execute", tone: "accent"  },
};

/** Fallback when a slug isn't in the registry yet — neutral diamond glyph. */
export const FALLBACK_FEATURE_META: FeatureMeta = {
  slug: "_unknown",
  Icon: ({ className = "w-3.5 h-3.5" }) => (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" />
    </svg>
  ),
  kind: "panel-execute",
  tone: "accent",
};

export function getFeatureMeta(slug: string): FeatureMeta {
  return FEATURE_META[slug] || { ...FALLBACK_FEATURE_META, slug };
}

/* ───────────────────────────────────────────────────────────────────
   Tone classes — Tailwind class strings paired with tone keys.
   Centralized so the dark/hover variants stay in sync everywhere.
   ─────────────────────────────────────────────────────────────────── */

export const TONE_CLASSES: Record<FeatureTone, { text: string; bg: string; hoverBorder: string }> = {
  accent:  { text: "text-accent",  bg: "bg-accent-subtle",  hoverBorder: "hover:border-accent/40"  },
  violet:  { text: "text-violet",  bg: "bg-violet-subtle",  hoverBorder: "hover:border-violet/40"  },
  cyan:    { text: "text-cyan",    bg: "bg-cyan-subtle",    hoverBorder: "hover:border-cyan/40"    },
  emerald: { text: "text-emerald", bg: "bg-emerald-subtle", hoverBorder: "hover:border-emerald/40" },
  amber:   { text: "text-amber",   bg: "bg-amber-subtle",   hoverBorder: "hover:border-amber/40"   },
  rose:    { text: "text-rose",    bg: "bg-rose-subtle",    hoverBorder: "hover:border-rose/40"    },
};
