"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { auth as authApi } from "@/lib/api";

// Module-level dedupe — React StrictMode in dev mounts effects twice, and
// Next.js will sometimes do the same when the search params re-resolve.
// Either way, we must NOT post the same OAuth code twice — the backend's
// state token is single-use, so the second post fails with a 400 (looking
// to the user like "OAuth state is invalid or expired") even though the
// first one succeeded.
//
// A useRef would scope the dedupe to a single mount, which doesn't help us
// across remounts. A module-level Map persists across both, keyed on the
// authorization code. The promise itself is cached so concurrent callers
// (the StrictMode double-mount) get the same result.
const inFlight = new Map<string, Promise<{ access_token: string; user: unknown }>>();

function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState("");
  // Defer "no code" judgement so we don't flash the error UI before params hydrate.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const code = params?.get("code");
    const errParam = params?.get("error");
    const state = params?.get("state");

    // GitHub itself may redirect back with ?error=access_denied when the user cancels.
    if (errParam) {
      setError(
        errParam === "access_denied"
          ? "GitHub sign-in was cancelled."
          : `GitHub returned an error: ${errParam}`,
      );
      setReady(true);
      return;
    }

    // No code yet — give Next.js one tick to hydrate the search params before
    // concluding the URL is truly empty.
    if (!code) {
      const t = setTimeout(() => {
        if (!params?.get("code") && !params?.get("error")) {
          setError("No authorization code received from GitHub. Please try again.");
          setReady(true);
        }
      }, 50);
      return () => clearTimeout(t);
    }

    // Dedupe: if we're already exchanging this exact code, await the
    // existing promise instead of posting a second time. The first caller
    // populated `inFlight[code]`; the StrictMode-doubled second caller
    // attaches to the same promise.
    let cancelled = false;
    let request = inFlight.get(code);
    if (!request) {
      request = authApi.githubCallback(code, state ?? undefined);
      inFlight.set(code, request);
      // Clean up the cache entry once the promise settles so memory doesn't
      // grow unbounded across many sign-ins in one session.
      request.finally(() => {
        // Tiny delay before purging — if any straggling re-mount fires after
        // settlement but before purge, it'll still hit the cached result
        // rather than posting fresh.
        setTimeout(() => inFlight.delete(code), 5000);
      });
    }

    request
      .then((result) => {
        if (cancelled) return;
        // Cast through unknown — the API typing for `user` lives in lib/api.ts.
        login(result.access_token, result.user as Parameters<typeof login>[1]);
        router.replace("/dashboard");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "GitHub authentication failed. Please try signing in again.");
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [params, login, router]);

  if (error && ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-6">
        <div className="card p-8 max-w-md text-center space-y-5 animate-fade-in">
          <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-danger/10 border border-danger/30">
            <svg className="w-7 h-7 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4.99a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold">Connection failed</h1>
            <p className="text-text-secondary text-sm mt-1.5 leading-relaxed">{error}</p>
          </div>
          <div className="flex gap-3 justify-center">
            <Link href="/auth?mode=login" className="btn-primary text-sm">Try again</Link>
            <Link href="/" className="btn-secondary text-sm">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-6">
      <div className="text-center space-y-4 animate-fade-in">
        <div className="relative inline-flex w-16 h-16 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-accent/20 blur-xl" aria-hidden="true" />
          <svg className="relative w-16 h-16 text-text-primary" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Connecting GitHub…</h1>
          <p className="text-text-muted text-sm">Completing the sign-in flow</p>
        </div>
        <div className="flex justify-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export default function GitHubCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Loading" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
