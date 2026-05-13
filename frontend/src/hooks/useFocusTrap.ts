/**
 * useFocusTrap — keep keyboard focus inside an open dialog/drawer/menu.
 *
 * When `active` is true:
 *   1. Records whatever element had focus before (so we can return there).
 *   2. Moves focus to the first focusable element inside the container.
 *   3. Cycles Tab / Shift+Tab between first and last focusable so the user
 *      can't escape the overlay with the keyboard.
 *
 * When `active` becomes false (or the component unmounts):
 *   4. Returns focus to the element that was focused before — important
 *      for keyboard users who'd otherwise lose their place.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(isOpen, ref);
 *   return isOpen ? <div ref={ref} role="dialog" ...> ... </div> : null;
 *
 * NOTE: this hook expects the container to be in the DOM when `active`
 * flips to true. If you conditionally render the container (the common
 * case), that's fine. If you keep it mounted but hidden via CSS, you'll
 * also want `inert` + `aria-hidden` while closed — see A9 in the audit.
 */

import { useEffect } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement>,
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus inside the container. If the container itself has tabIndex,
    // prefer focusing the container so screen readers announce the dialog name.
    const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusable[0];
    if (first) {
      // Defer to the next frame so any opening animation doesn't steal focus.
      requestAnimationFrame(() => first.focus());
    } else if (container.tabIndex >= 0) {
      requestAnimationFrame(() => container.focus());
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      // Re-query each time — the focusable set can change as content updates.
      const items = container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Return focus to where it was before the overlay opened. Guard
      // against the previously-focused element being unmounted in the
      // meantime (e.g. a button that triggered a route change).
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
