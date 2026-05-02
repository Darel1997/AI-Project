"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Global keyboard shortcuts. Gmail-style sequences:
 *   g d → /dashboard
 *   g c → /chat
 *   g a → /analytics
 *   g s → /settings
 * Also:
 *   ? → open Settings shortcuts help (we just go to /settings)
 *
 * Shortcuts are suppressed when the user is typing in any input/textarea.
 */
export function useGlobalShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let waitingForSecondKey = false;
    let timeoutId: NodeJS.Timeout | null = null;

    function reset() {
      waitingForSecondKey = false;
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    }

    function isTyping(e: KeyboardEvent): boolean {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      return (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable
      );
    }

    function onKey(e: KeyboardEvent) {
      if (isTyping(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // "?" opens the settings shortcut page
      if (e.key === "?") {
        e.preventDefault();
        router.push("/settings");
        return;
      }

      if (!waitingForSecondKey && e.key === "g") {
        waitingForSecondKey = true;
        timeoutId = setTimeout(reset, 1200);
        return;
      }

      if (waitingForSecondKey) {
        const targets: Record<string, string> = {
          d: "/dashboard",
          c: "/chat",
          a: "/analytics",
          i: "/insights",
          s: "/settings",
          o: "/orgs",
          h: "/dashboard", // home alias
        };
        const target = targets[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          router.push(target);
        }
        reset();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [router]);
}
