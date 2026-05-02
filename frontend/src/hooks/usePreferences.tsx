"use client";

/**
 * usePreferences — global hook + provider for accessibility & UX settings.
 *
 * Why a provider (not just localStorage)?
 *   1. Settings need to apply globally (the `<html>` element is the right surface
 *      for theme/density/font-size CSS variables — every component then inherits).
 *   2. Components that adapt to a setting (e.g., a chart that respects reduced
 *      motion) need to re-render when the setting changes, which a context handles.
 *   3. We want one source of truth so the Settings page and consumers can both
 *      read/write through the same API.
 *
 * Design decisions:
 *   - Persist to localStorage under one key (`ri:prefs`). Survives reload, scoped
 *     per-browser. We don't sync to the server — these are device preferences,
 *     not account preferences. Glasses-on at home, bright phone outside.
 *   - System defaults: theme follows `prefers-color-scheme`, motion follows
 *     `prefers-reduced-motion`. We honor those out of the box and let the user
 *     override per-device.
 *   - The provider applies settings via `data-*` attributes on <html>. CSS
 *     in globals.css then keys off those data attributes. Cheap, declarative,
 *     no inline styles to manage.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Theme        = "system" | "dark" | "light";
export type FontSize     = "default" | "large" | "extra-large";
export type Density      = "comfortable" | "compact";
export type Motion       = "system" | "full" | "reduced";
export type Contrast     = "default" | "high";

/** All the preferences we persist. Add new ones to this shape and to DEFAULTS. */
export interface Preferences {
  theme:    Theme;
  fontSize: FontSize;
  density:  Density;
  motion:   Motion;
  contrast: Contrast;
  /** Send email when a long-running scan finishes (server-side, not local). */
  emailOnScanComplete: boolean;
  /** Weekly digest of repository activity. */
  emailWeeklyDigest:   boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme:    "system",
  fontSize: "default",
  density:  "comfortable",
  motion:   "system",
  contrast: "default",
  emailOnScanComplete: true,
  emailWeeklyDigest:   false,
};

const STORAGE_KEY = "ri:prefs";

interface PreferencesContextValue {
  prefs: Preferences;
  /** Update a single preference. Triggers a re-render and a localStorage write. */
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  /** Reset every preference to its default. */
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue>({
  prefs: DEFAULT_PREFERENCES,
  setPref: () => {},
  reset: () => {},
});

function loadFromStorage(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    // Merge over defaults so that adding a new preference key in a release
    // doesn't break users with older stored payloads.
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Resolves the *effective* theme — what the UI should render right now.
 * `system` defers to the user's OS preference via `prefers-color-scheme`.
 */
function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Resolves whether motion should be reduced. `system` defers to the OS.
 */
function resolveMotion(motion: Motion): "full" | "reduced" {
  if (motion !== "system") return motion;
  if (typeof window === "undefined") return "full";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  // Load on mount. We start with DEFAULTS (server-side rendering safety) and
  // hydrate from localStorage in this effect to match what the user set last.
  useEffect(() => {
    setPrefs(loadFromStorage());
  }, []);

  // Apply preferences to <html> as data-attributes whenever they change.
  // CSS in globals.css reads these attributes to switch theme tokens, scale
  // typography, tighten spacing, etc.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;

    const effectiveTheme = resolveTheme(prefs.theme);
    const effectiveMotion = resolveMotion(prefs.motion);

    html.dataset.theme    = effectiveTheme;
    html.dataset.fontSize = prefs.fontSize;
    html.dataset.density  = prefs.density;
    html.dataset.motion   = effectiveMotion;
    html.dataset.contrast = prefs.contrast;

    // Persist (skip the very first effect run before localStorage is loaded —
    // the next effect will overwrite if needed, no harm done since it's idempotent).
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable (private mode, etc.) — silent failure is fine */
    }
  }, [prefs]);

  // Re-resolve `system` themes when the OS preference flips while the app is open.
  // Without this, a user who changes their system theme has to reload to see it apply.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prefs.theme !== "system" && prefs.motion !== "system") return;

    const themeMq  = window.matchMedia("(prefers-color-scheme: light)");
    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const nudge = () => setPrefs(p => ({ ...p })); // identity-update to retrigger the apply effect
    themeMq.addEventListener("change", nudge);
    motionMq.addEventListener("change", nudge);
    return () => {
      themeMq.removeEventListener("change", nudge);
      motionMq.removeEventListener("change", nudge);
    };
  }, [prefs.theme, prefs.motion]);

  const value = useMemo<PreferencesContextValue>(() => ({
    prefs,
    setPref: (key, value) => setPrefs(p => ({ ...p, [key]: value })),
    reset:   () => setPrefs(DEFAULT_PREFERENCES),
  }), [prefs]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
