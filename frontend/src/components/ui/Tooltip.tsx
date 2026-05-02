"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export function Tooltip({ content, children, side = "top", delay = 400 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  function show() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }
  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }

  // Dismiss on Escape (WCAG 1.4.13)
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const position: Record<string, string> = {
    top:    "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left:   "right-full top-1/2 -translate-y-1/2 mr-2",
    right:  "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`absolute z-50 px-2.5 py-1.5 bg-surface-overlay border border-surface-border rounded-md text-xs text-text-primary shadow-card whitespace-nowrap pointer-events-none animate-fade-in ${position[side]}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
