"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "◫" },
  { href: "/repos", label: "Repositories", icon: "⑂" },
  { href: "/chat", label: "Chat", icon: "◈" },
  { href: "/analytics", label: "Analytics", icon: "◩" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 h-screen bg-surface-raised border-r border-surface-border flex flex-col fixed left-0 top-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-surface-border">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm">
            RI
          </div>
          <span className="font-semibold text-[15px]">RepoInsight</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-overlay"
              )}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-surface-border">
        <div className="flex items-center gap-3 px-3 py-2">
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="w-8 h-8 rounded-full"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold">
              {(user?.full_name || user?.email || "U")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user?.full_name || user?.email}
            </p>
            {user?.github_username && (
              <p className="text-xs text-text-muted truncate">
                @{user.github_username}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full mt-2 text-left px-3 py-1.5 text-sm text-text-muted hover:text-danger transition-colors rounded"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
