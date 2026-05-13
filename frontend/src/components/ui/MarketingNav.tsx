"use client";

/**
 * MarketingNav — the public-page header.
 *
 * Used by /, /pricing, /blog, /security, /changelog, /enterprise, and /status.
 * Exists because every marketing page used to roll its own nav, and the link
 * sets, ordering, breakpoints, and styling drifted apart over time. Centralizing
 * it here means a new page (or a renamed link) updates everywhere at once.
 *
 * Responsive behavior:
 *   - Desktop (sm/md+): inline links visible directly in the bar.
 *   - Mobile (< sm): all links hidden behind a hamburger button that opens
 *     a full-screen drawer. Without this, mobile visitors couldn't navigate
 *     the marketing site at all — the original implementation used
 *     `hidden sm:inline-flex` on every link and had no fallback.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthNavButton } from "./AuthNavButton";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface NavLink {
  /** href to navigate to. External hash links work too: "/#features". */
  href: string;
  /** Visible label. */
  label: string;
  /** When true, link is hidden in the desktop nav until viewport ≥ md (768px). Still always present in the mobile drawer. */
  desktopOnly?: boolean;
}

/** The canonical link order for the public pages. Changes here propagate to every marketing page. */
const LINKS: NavLink[] = [
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/enterprise", label: "Enterprise", desktopOnly: true },
  { href: "/blog", label: "Blog", desktopOnly: true },
  { href: "/security", label: "Security" },
  { href: "/changelog", label: "Changelog", desktopOnly: true },
];

export function MarketingNav({ active }: { active?: string } = {}) {
  const pathname = usePathname() || "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(mobileOpen, drawerRef);

  // Match against the start of the pathname so /blog/some-post still highlights /blog.
  // Hash links (/#features) are never active because they jump within / itself.
  const isActive = (href: string) => {
    if (active) return active === href;
    if (href.startsWith("/#")) return false;
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  // Close the drawer if the user navigates (e.g. taps a link inside it),
  // resizes past the breakpoint, or hits Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    function onResize() {
      // Tailwind's sm breakpoint is 640px. Above it, the desktop nav is
      // visible and the drawer should disappear.
      if (window.innerWidth >= 640) setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [mobileOpen]);

  // Lock body scroll while the drawer is open so the page underneath
  // doesn't scroll when the user swipes inside the menu.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <header className="relative z-30 sticky top-0 border-b border-white/5 bg-surface/80 backdrop-blur-xl">
      <nav
        className="max-w-7xl mx-auto px-6 py-3.5 flex justify-between items-center gap-4"
        aria-label="Primary"
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 group shrink-0"
          aria-label="RepoInsight AI home"
        >
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-[13px] shadow-glow-sm group-hover:shadow-glow transition-shadow">
            RI
          </div>
          <span className="text-[15px] font-semibold tracking-tight">RepoInsight</span>
        </Link>

        <div className="flex items-center gap-1">
          {/* Desktop inline links — hidden below sm. */}
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`btn-ghost text-sm ${
                link.desktopOnly ? "hidden md:inline-flex" : "hidden sm:inline-flex"
              } ${isActive(link.href) ? "text-text-primary" : ""}`}
            >
              {link.label}
            </Link>
          ))}

          {/* Mobile hamburger — only visible below sm. */}
          <button
            type="button"
            className="sm:hidden btn-ghost p-2"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>

          <div className="ml-2">
            <AuthNavButton />
          </div>
        </div>
      </nav>

      {/* Mobile drawer — only rendered when open so screen readers and
          keyboard users never see it while hidden. */}
      {mobileOpen && (
        <div
          ref={drawerRef}
          id="mobile-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className="sm:hidden fixed inset-0 z-50 bg-surface/95 backdrop-blur-xl animate-fade-in"
          onClick={(e) => {
            // Click on the backdrop (not on a child) closes the drawer.
            if (e.target === e.currentTarget) setMobileOpen(false);
          }}
        >
          <div className="flex flex-col h-full p-6">
            <div className="flex justify-between items-center">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5"
                aria-label="RepoInsight AI home"
              >
                <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-[13px]">
                  RI
                </div>
                <span className="text-[15px] font-semibold tracking-tight">RepoInsight</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="btn-ghost p-2"
                aria-label="Close menu"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
            </div>

            <nav className="mt-10 flex flex-col gap-1" aria-label="Site sections">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`text-lg px-3 py-3 rounded-md hover:bg-surface-overlay transition-colors ${
                    isActive(link.href) ? "text-text-primary bg-surface-overlay/60" : "text-text-secondary"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
