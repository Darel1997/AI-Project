"use client";

/**
 * MarketingNav — the public-page header.
 *
 * Used by /, /pricing, /blog, /security, /changelog, /enterprise, and /status.
 * Exists because every marketing page used to roll its own nav, and the link
 * sets, ordering, breakpoints, and styling drifted apart over time. Centralizing
 * it here means a new page (or a renamed link) updates everywhere at once.
 *
 * The active page is highlighted automatically — pass `active` if you want to
 * override it (e.g. a sub-page that should highlight its parent).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthNavButton } from "./AuthNavButton";

interface NavLink {
  /** href to navigate to. External hash links work too: "/#features". */
  href: string;
  /** Visible label. */
  label: string;
  /** When true, link is hidden until viewport ≥ md (768px). */
  desktopOnly?: boolean;
}

/** The canonical link order for the public pages. Changes here propagate to every marketing page. */
const LINKS: NavLink[] = [
  { href: "/#features",  label: "Features"  },
  { href: "/pricing",    label: "Pricing"   },
  { href: "/enterprise", label: "Enterprise", desktopOnly: true },
  { href: "/blog",       label: "Blog",       desktopOnly: true },
  { href: "/security",   label: "Security"  },
  { href: "/changelog",  label: "Changelog", desktopOnly: true },
];

export function MarketingNav({ active }: { active?: string } = {}) {
  const pathname = usePathname() || "";
  // Match against the start of the pathname so /blog/some-post still highlights /blog.
  // Hash links (/#features) are never active because they jump within / itself.
  const isActive = (href: string) => {
    if (active) return active === href;
    if (href.startsWith("/#")) return false;
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <header className="relative z-30 sticky top-0 border-b border-white/5 bg-surface/80 backdrop-blur-xl">
      <nav className="max-w-7xl mx-auto px-6 py-3.5 flex justify-between items-center gap-4" aria-label="Primary">
        <Link href="/" className="flex items-center gap-2.5 group shrink-0" aria-label="RepoInsight AI home">
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-[13px] shadow-glow-sm group-hover:shadow-glow transition-shadow">
            RI
          </div>
          <span className="text-[15px] font-semibold tracking-tight">RepoInsight</span>
        </Link>

        <div className="flex items-center gap-1">
          {LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`btn-ghost text-sm ${link.desktopOnly ? "hidden md:inline-flex" : "hidden sm:inline-flex"} ${
                isActive(link.href) ? "text-text-primary" : ""
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="ml-2">
            <AuthNavButton />
          </div>
        </div>
      </nav>
    </header>
  );
}
