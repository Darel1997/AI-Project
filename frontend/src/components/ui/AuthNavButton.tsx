"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

/**
 * Public-page auth affordance. Renders:
 *   - a subtle placeholder while auth is loading (prevents layout shift)
 *   - a "Log in" button when signed out
 *   - a profile chip (avatar + name) that links to /dashboard when signed in
 *
 * Used in the top nav of every public-facing page (landing, pricing,
 * changelog, blog).
 */
export function AuthNavButton() {
  const { user, loading } = useAuth();

  if (loading) {
    // Keeps the nav stable during auth hydration
    return <div className="w-20 h-9" aria-hidden="true" />;
  }

  if (user) {
    return (
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full hover:bg-surface-overlay border border-transparent hover:border-surface-border transition-colors group"
        aria-label={`Go to dashboard · signed in as ${user.full_name || user.email}`}
      >
        {user.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full ring-1 ring-surface-border" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent/30 to-accent/10 flex items-center justify-center text-accent text-xs font-bold ring-1 ring-accent/20">
            {(user.full_name || user.email)[0].toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium max-w-[160px] truncate group-hover:text-accent transition-colors hidden sm:inline">
          {user.full_name || user.email.split("@")[0]}
        </span>
      </Link>
    );
  }

  return (
    <Link href="/auth?mode=login" className="btn-secondary text-sm">
      Log in
    </Link>
  );
}
