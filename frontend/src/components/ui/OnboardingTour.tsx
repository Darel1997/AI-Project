"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Step {
  title: string;
  description: string;
  cta: string;
  icon: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Welcome to RepoInsight",
    description:
      "Let's take 30 seconds to show you around. You'll analyze your first codebase in minutes.",
    cta: "Let's go",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5z" strokeLinejoin="round" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Import any GitHub repo",
    description:
      "Paste a public GitHub URL on your dashboard — yours or someone else's. RepoInsight indexes it locally in under a minute.",
    cta: "Next",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.38.6.11.82-.25.82-.57v-2C4 22 3.5 19.5 3.5 19.5 3 18.5 2 18 2 18c-1-.73.08-.72.08-.72 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.3.76-1.6C5.62 17.6 2.66 16.6 2.66 12c0-1.3.47-2.39 1.24-3.23C3.78 8.47 3.36 7.24 4 5.6c0 0 1.01-.32 3.3 1.23A11.54 11.54 0 0112 6.34a11.54 11.54 0 014.7.49c2.29-1.55 3.29-1.23 3.29-1.23.65 1.64.24 2.87.12 3.17.77.84 1.23 1.93 1.23 3.23 0 4.62-2.97 5.6-5.78 5.9.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
      </svg>
    ),
  },
  {
    title: "Chat with your repo",
    description:
      "Use Chat to ask questions in plain English. Every answer cites the exact files and line numbers it drew from.",
    cta: "Next",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    title: "Generate audits & reports",
    description:
      "Run code quality scans, security audits, onboarding guides, and architecture diagrams. Export Markdown reports to share with your team.",
    cta: "Get started",
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  },
];

const STORAGE_KEY = "ri:onboarding-completed";

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Give the page a beat to settle before showing
      setTimeout(() => setOpen(true), 600);
    }
  }, []);

  // Escape to dismiss
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") skip();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  function complete() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  function skip() {
    complete();
  }

  function next() {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else complete();
  }

  function prev() {
    if (step > 0) setStep(s => s - 1);
  }

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
    >
      <div className="card shadow-card-hover max-w-md w-full overflow-hidden animate-scale-in">
        {/* Progress bar at the top */}
        <div className="h-1 bg-surface-border">
          <div
            className="h-full bg-gradient-to-r from-accent to-accent-muted transition-all duration-300 ease-smooth"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            role="progressbar"
            aria-valuenow={step + 1}
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
          />
        </div>

        {/* Header with skip button */}
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <span className="text-xs text-text-muted font-medium">
            Step {step + 1} of {STEPS.length}
          </span>
          <button
            onClick={skip}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Skip tour
          </button>
        </div>

        {/* Icon */}
        <div className="px-6 pt-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/30 to-accent-muted/20 flex items-center justify-center text-accent ring-1 ring-accent/20">
            {current.icon}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pt-4 pb-6 space-y-2">
          <h2 id="onboarding-title" className="text-xl font-semibold tracking-tight">
            {current.title}
          </h2>
          <p id="onboarding-desc" className="text-text-secondary text-sm leading-relaxed">
            {current.description}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          {/* Dots */}
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Tour steps">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-6 bg-accent" : "w-1.5 bg-surface-border hover:bg-text-muted"
                }`}
                aria-label={`Go to step ${i + 1}`}
                aria-selected={i === step}
                role="tab"
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={prev} className="btn-ghost text-sm">
                Back
              </button>
            )}
            {isLast ? (
              <Link href="/dashboard" onClick={complete} className="btn-primary text-sm">
                {current.cta}
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ) : (
              <button onClick={next} className="btn-primary text-sm">
                {current.cta}
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
