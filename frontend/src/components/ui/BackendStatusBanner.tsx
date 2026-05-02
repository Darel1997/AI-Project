"use client";

/**
 * BackendStatusBanner — actively polls the API's /health endpoint and renders a
 * banner when the backend is unreachable or starting up. Mounting this on a
 * critical page (login, register, dashboard) means users see the connection
 * problem BEFORE they click a button — instead of after, when they hit a
 * confusing error.
 *
 * State machine:
 *   - checking  → no banner. We don't want to flash "down" during a normal probe.
 *   - ok        → no banner.
 *   - starting  → soft yellow banner, keeps polling fast (every 2s).
 *   - down      → red banner with explicit "Retry" + diagnostic instructions.
 *
 * Polls every 2s while non-OK, every 60s while OK, and pauses entirely when
 * the tab is hidden so we don't waste request budget.
 */

import { useEffect, useRef, useState } from "react";
import { checkHealth, HealthState, API_URL } from "@/lib/api";

export function BackendStatusBanner() {
  const [state, setState] = useState<HealthState | "checking">("checking");
  const [retrying, setRetrying] = useState(false);
  const [hasBeenDown, setHasBeenDown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function probe() {
    const next = await checkHealth();
    setState(next);
    if (next !== "ok") setHasBeenDown(true);
  }

  // Initial probe + interval
  useEffect(() => {
    let mounted = true;

    function schedule(delay: number) {
      if (!mounted) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (typeof document !== "undefined" && document.hidden) {
          // Tab is hidden — back off and try again later. No point polling
          // an API the user isn't even looking at.
          schedule(15_000);
          return;
        }
        await probe();
        // Schedule next probe based on current state — fast while broken,
        // lazy while healthy so we don't burn request budget.
        const interval = state === "ok" ? 60_000 : 2_500;
        schedule(interval);
      }, delay);
    }

    probe().then(() => schedule(state === "ok" ? 60_000 : 2_500));

    function onVisibility() {
      if (!document.hidden) probe();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    setRetrying(true);
    await probe();
    setRetrying(false);
  }

  // While we've never seen the API down, render nothing — no flash of yellow on
  // first paint, no jitter on flaky networks.
  if (state === "checking" || (state === "ok" && !hasBeenDown)) return null;

  // Recovery confirmation — show briefly, then dismiss
  if (state === "ok" && hasBeenDown) {
    return <RecoveredBanner onDismiss={() => setHasBeenDown(false)} />;
  }

  if (state === "starting") {
    return (
      <div className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 flex items-start gap-3" role="status">
        <div className="w-4 h-4 mt-0.5 border-2 border-amber border-t-transparent rounded-full animate-spin shrink-0" aria-hidden="true" />
        <div className="text-sm flex-1">
          <p className="font-semibold text-amber">Backend is starting up…</p>
          <p className="text-text-secondary text-xs mt-0.5 leading-relaxed">
            The API server is responding but isn&apos;t ready yet. This usually clears in a few seconds.
          </p>
        </div>
      </div>
    );
  }

  // state === "down"
  return (
    <div className="rounded-lg border border-rose/30 bg-rose/10 px-4 py-3.5 flex items-start gap-3" role="alert">
      <svg className="w-4 h-4 mt-0.5 text-rose shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="10" cy="10" r="8" />
        <path d="M10 6v4M10 14v.01" strokeLinecap="round" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-rose">Backend is unreachable.</p>
        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
          We can&apos;t reach the API server at <code className="font-mono text-[11px] bg-rose/10 px-1 py-0.5 rounded">{API_URL}</code>.
          Sign-in, sign-up, and all live data are paused until it&apos;s back.
        </p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-text-muted hover:text-text-primary transition-colors select-none">
            How to fix this
          </summary>
          <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-rose/20 text-text-secondary">
            <p>1. Make sure Docker is running.</p>
            <p>2. From the project directory, run <code className="font-mono text-[11px] bg-surface-overlay px-1 py-0.5 rounded">docker compose ps</code> — the <code className="font-mono">api</code> service should say <code className="font-mono">healthy</code>.</p>
            <p>3. If it&apos;s <code className="font-mono">unhealthy</code> or missing, run <code className="font-mono text-[11px] bg-surface-overlay px-1 py-0.5 rounded">docker compose logs api --tail 50</code> to see why.</p>
            <p>4. If everything looks fine, the API may be starting — wait a few seconds and click Retry.</p>
          </div>
        </details>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleRetry}
            disabled={retrying}
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-rose/15 text-rose border border-rose/30 hover:bg-rose/20 transition-colors disabled:opacity-50"
          >
            {retrying ? (
              <>
                <span className="w-3 h-3 border-2 border-rose border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                Checking…
              </>
            ) : (
              <>
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M14 3v5h-5M2 13v-5h5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 8a6 6 0 0110-3l1 3M13 8a6 6 0 01-10 3l-1-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Retry now
              </>
            )}
          </button>
          <a
            href={`${API_URL}/health/detail`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Open diagnostics →
          </a>
        </div>
      </div>
    </div>
  );
}

function RecoveredBanner({ onDismiss }: { onDismiss: () => void }) {
  // Auto-dismiss after 4 seconds — we don't want this to linger.
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="rounded-lg border border-emerald/30 bg-emerald/10 px-4 py-2.5 flex items-center gap-2.5" role="status">
      <svg className="w-4 h-4 text-emerald shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm font-medium text-emerald flex-1">Backend is back online.</p>
      <button onClick={onDismiss} className="text-xs text-text-muted hover:text-text-primary" aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}
