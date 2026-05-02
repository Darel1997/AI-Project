/**
 * RepoIcons — small, original SVG icons used wherever the dashboard, chat
 * sidebar, or repo lists need to surface a repo at a glance.
 *
 * Three families:
 *
 *   1. LanguageDot — colored dot keyed off the repo's primary language.
 *      Standard "GitHub-style" treatment that engineers recognize at a glance.
 *      Pure CSS dot, no SVG, so it costs nothing and scales cleanly.
 *
 *   2. StatusIcon — replaces the old emoji glyphs (✓ ⟳ ⧗ ✗) on StatusBadge.
 *      Emojis render differently across OSes and don't pick up text color;
 *      proper SVG keeps the badge looking the same on Windows, macOS, and Linux.
 *
 *   3. FrameworkIcon — original mark for each FEATURED_REPO. These are not
 *      copies of the real Flask/Express/FastAPI logos. Each is a small
 *      thematic glyph designed in-house to suggest the framework's character:
 *        - Flask     → a chemistry-flask silhouette (flask = vessel)
 *        - Express   → a speedometer-needle motif (express = fast)
 *        - FastAPI   → a lightning bolt over brackets (fast + API)
 *
 *   4. RepoStatIcon — tiny icons for the file/line/contributor stat row on
 *      repo cards. Previously these were three text strings with no visual
 *      anchor; now each gets a 12px icon so the row scans much faster.
 */

import React from "react";

/* ───────────────────────────────────────────────────────────────────
   1. Language dot
   ─────────────────────────────────────────────────────────────────── */

/**
 * Curated palette covering the languages we actually see in user repos.
 * Falls back to a neutral grey for anything unrecognized — better than
 * white for an unknown language because it doesn't look like a "selected"
 * state that's missed an icon.
 */
const LANGUAGE_COLORS: Record<string, string> = {
  // Top tier — the languages most repos in the system use
  "JavaScript":  "#f1e05a",
  "TypeScript":  "#3178c6",
  "Python":      "#3572a5",
  "Go":          "#00add8",
  "Rust":        "#dea584",
  "Java":        "#b07219",
  "Kotlin":      "#a97bff",
  "Swift":       "#f05138",
  "C":           "#555555",
  "C++":         "#f34b7d",
  "C#":          "#178600",
  "Ruby":        "#701516",
  "PHP":         "#4f5d95",
  "Shell":       "#89e051",
  "HTML":        "#e34c26",
  "CSS":         "#563d7c",
  "SCSS":        "#c6538c",
  "Vue":         "#41b883",
  "Svelte":      "#ff3e00",
  "Elixir":      "#6e4a7e",
  "Erlang":      "#b83998",
  "Haskell":     "#5e5086",
  "Lua":         "#000080",
  "Perl":        "#0298c3",
  "R":           "#198ce7",
  "Scala":       "#c22d40",
  "Clojure":     "#db5855",
  "Dart":        "#00b4ab",
  "Zig":         "#ec915c",
  "Nim":         "#ffc200",
  "OCaml":       "#3be133",
  "Crystal":     "#000100",
  "Elm":         "#60b5cc",
  "F#":          "#b845fc",
  "Julia":       "#a270ba",
  "ObjectiveC":  "#438eff",
  "Objective-C": "#438eff",
  "Solidity":    "#aa6746",
  // Markup / data — common in mixed repos
  "Markdown":    "#083fa1",
  "JSON":        "#cccccc",
  "YAML":        "#cb171e",
  "TOML":        "#9c4221",
  "Makefile":    "#427819",
  "Dockerfile":  "#384d54",
};

export function LanguageDot({ language, size = 10 }: { language?: string | null; size?: number }) {
  if (!language) return null;
  const color = LANGUAGE_COLORS[language] || "#9ca3af";
  return (
    <span
      className="inline-block rounded-full shrink-0 ring-1 ring-black/10"
      style={{ width: size, height: size, backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

/** Returns the color we'd use for this language, exposed for charts/legends. */
export function languageColor(language?: string | null): string {
  if (!language) return "#9ca3af";
  return LANGUAGE_COLORS[language] || "#9ca3af";
}

/* ───────────────────────────────────────────────────────────────────
   2. Status icons — replaces emoji glyphs in StatusBadge
   ─────────────────────────────────────────────────────────────────── */

export type RepoStatus = "done" | "indexing" | "pending" | "failed";

export function StatusIcon({ status, className = "w-3 h-3" }: { status: RepoStatus | string; className?: string }) {
  switch (status) {
    case "done":
      return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M3 8.5l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "indexing":
      // Animated spinner — actively-working state
      return (
        <svg className={`${className} animate-spin`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M8 2a6 6 0 016 6" strokeLinecap="round" />
          <path d="M2 8a6 6 0 002 4.47" strokeLinecap="round" opacity="0.4" />
        </svg>
      );
    case "pending":
      // Hourglass — waiting in queue
      return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M4 2h8M4 14h8" strokeLinecap="round" />
          <path d="M5 2v2.5L8 8l3-3.5V2M5 14v-2.5L8 8l3 3.5V14" strokeLinejoin="round" />
        </svg>
      );
    case "failed":
      // Octagonal warning sign — failure state, distinct from a plain X
      return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5.5 2h5l3.5 3.5v5L10.5 14h-5L2 10.5v-5L5.5 2z" strokeLinejoin="round" />
          <path d="M8 5.5v3M8 10.5v.01" strokeLinecap="round" />
        </svg>
      );
    default:
      // Unknown — info dot
      return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4M8 5v.01" strokeLinecap="round" />
        </svg>
      );
  }
}

/* ───────────────────────────────────────────────────────────────────
   3. Framework icons — original glyphs for the FEATURED_REPOS row
   ─────────────────────────────────────────────────────────────────── */

/**
 * Each framework icon is hand-drawn here rather than imported from a
 * trademark holder. They're meant to *evoke* the framework's vibe, not
 * replicate its real logo. The 24×24 viewBox gives every one a consistent
 * footprint.
 */

/** Flask — chemistry beaker. Classic flask silhouette with a bubbling top. */
export function FlaskIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Neck */}
      <path d="M9 3h6" />
      <path d="M9.5 3v6.2" />
      <path d="M14.5 3v6.2" />
      {/* Bulb */}
      <path d="M9.5 9.2L4.5 18a2 2 0 001.7 3h11.6a2 2 0 001.7-3L14.5 9.2" />
      {/* Bubbles */}
      <circle cx="10" cy="16" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="13" cy="14.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="17.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Express — speedometer needle, suggesting "express" = fast. */
export function ExpressIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Speedometer arc */}
      <path d="M3 16a9 9 0 0118 0" />
      {/* Tick marks at 0, 90, 180 */}
      <path d="M3 16h2" />
      <path d="M12 7v2" />
      <path d="M19 16h2" />
      {/* Needle pointing top-right */}
      <path d="M12 16l5-3.5" strokeWidth="2.2" />
      {/* Pivot dot */}
      <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** FastAPI — lightning bolt threaded through angle brackets. */
export function FastAPIIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Left bracket */}
      <path d="M6 7l-3 5 3 5" />
      {/* Right bracket */}
      <path d="M18 7l3 5-3 5" />
      {/* Lightning bolt — center, slightly tilted */}
      <path d="M13 5l-3 6h3l-2 6 5-7h-3l2-5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Empty repo state — a folder-with-spark icon. Used by the empty state hero. */
export function EmptyRepoIcon({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7l2-3h6l2 3h8v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      {/* Sparkle to suggest "new analysis happens here" */}
      <path d="M16 13.5v3M14.5 15h3" />
    </svg>
  );
}

/* ───────────────────────────────────────────────────────────────────
   4. Repo stat icons — tiny anchors for files / lines / contributors
   ─────────────────────────────────────────────────────────────────── */

export function FilesIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" />
      <path d="M9 2v4h4" />
    </svg>
  );
}

export function LinesIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <path d="M3 4h10M3 8h7M3 12h10" />
    </svg>
  );
}

export function StarsIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5l1.94 4.06L14 6.2l-3 2.94.74 4.36L8 11.5l-3.74 2 .74-4.36L2 6.2l4.06-.64L8 1.5z" />
    </svg>
  );
}

/** Quality / health score — a circular gauge motif. */
export function QualityIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <path d="M3 11a5 5 0 0110 0" />
      <path d="M8 11l3-3" />
      <circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
