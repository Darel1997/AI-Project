"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console in dev; in prod you'd wire this to Sentry/LogRocket
    console.error("Runtime error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-6">
      <div className="max-w-md w-full text-center space-y-6 animate-fade-in">
        <div className="relative inline-flex w-20 h-20 items-center justify-center rounded-full bg-danger/10 border border-danger/30">
          <svg className="w-10 h-10 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4.99a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-display-3">Something went wrong</h1>
          <p className="text-text-secondary text-pretty">
            The page encountered an unexpected error. You can try again or head back home.
          </p>
          {error.digest && (
            <p className="text-xs text-text-muted mt-3 font-mono">
              Error ID: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <button onClick={reset} className="btn-primary px-6">
            Try again
          </button>
          <Link href="/dashboard" className="btn-secondary px-6">
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
