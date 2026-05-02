/**
 * Quality Score helpers — shared across the dashboard, analytics, and repo detail pages.
 *
 * The score is a 0-100 number computed by the backend (single canonical formula).
 * These helpers translate it into user-friendly UI: plain-English label, color,
 * and a one-sentence explanation.
 *
 * Keep the thresholds in sync with backend/app/services/quality_score.py.
 */

export type QualityTone = "emerald" | "accent" | "amber" | "rose";

export interface QualityDescriptor {
  label: string;       // "Excellent", "Good", "Fair", "Needs work", "Poor"
  tone: QualityTone;   // color key — maps to text-{tone} / bg-{tone}-subtle Tailwind classes
  hexColor: string;    // raw hex — for inline styles (progress bars, SVG)
  description: string; // one-sentence plain-English explanation
}

export function qualityDescriptor(score: number | null | undefined): QualityDescriptor {
  if (score == null) {
    return {
      label: "Not analyzed",
      tone: "accent",
      hexColor: "#7a8190",
      description: "This repository hasn't been analyzed yet.",
    };
  }
  if (score >= 85) {
    return {
      label: "Excellent",
      tone: "emerald",
      hexColor: "#34d399",
      description: "Well-structured, actively maintained, and thoroughly documented.",
    };
  }
  if (score >= 70) {
    return {
      label: "Good",
      tone: "emerald",
      hexColor: "#34d399",
      description: "Solid project with good structure and healthy activity.",
    };
  }
  if (score >= 55) {
    return {
      label: "Fair",
      tone: "accent",
      hexColor: "#7c6bff",
      description: "Functional but could benefit from better tests, docs, or activity.",
    };
  }
  if (score >= 35) {
    return {
      label: "Needs work",
      tone: "amber",
      hexColor: "#fbbf24",
      description: "Several quality concerns — consider addressing tests, docs, or file structure.",
    };
  }
  return {
    label: "Poor",
    tone: "rose",
    hexColor: "#fb7185",
    description: "Significant issues detected. See reports for specific improvements.",
  };
}

/**
 * Returns the Tailwind text color class for a given score.
 * Use this when you just need a color, not the full descriptor.
 */
export function qualityTextColor(score: number | null | undefined): string {
  const { tone } = qualityDescriptor(score);
  return `text-${tone}`;
}
