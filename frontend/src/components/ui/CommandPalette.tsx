"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { repos as reposApi, Repo } from "@/lib/api";

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: () => JSX.Element;
  action: () => void;
  keywords?: string;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global shortcut — Cmd+K / Ctrl+K to open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load repos lazily when opening for the first time
  useEffect(() => {
    if (open && repos.length === 0) {
      reposApi.list().then(d => setRepos(d.repos)).catch(() => {});
    }
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, repos.length]);

  const close = useCallback(() => setOpen(false), []);

  // Build the command list
  const commands: Command[] = useMemo(() => {
    const go = (path: string) => () => { close(); router.push(path); };
    const base: Command[] = [
      { id: "nav-home",      group: "Navigate", label: "Home (landing page)", action: go("/"),           keywords: "main site landing" },
      { id: "nav-dash",      group: "Navigate", label: "Dashboard",     action: go("/dashboard"),  hint: "G then D", keywords: "home repos" },
      { id: "nav-chat",      group: "Navigate", label: "Chat",          action: go("/chat"),       hint: "G then C", keywords: "ask question" },
      { id: "nav-analytics", group: "Navigate", label: "Analytics",     action: go("/analytics"),  hint: "G then A", keywords: "charts graphs" },
      { id: "nav-insights",  group: "Navigate", label: "Insights",      action: go("/insights"),   hint: "G then I", keywords: "cross repo intelligence duplicates extraction drift" },
      { id: "nav-orgs",      group: "Navigate", label: "Organizations", action: go("/orgs"),                         keywords: "team workspace members" },
      { id: "nav-billing",   group: "Navigate", label: "Billing & plan",action: go("/settings/billing"),             keywords: "subscription upgrade invoice payment" },
      { id: "nav-integrations", group: "Navigate", label: "Integrations",action: go("/settings/integrations"),         keywords: "slack github jira linear notion connect" },
      { id: "nav-settings",  group: "Navigate", label: "Settings",      action: go("/settings"),   hint: "G then S", keywords: "profile account password" },
    ];
    const repoCommands: Command[] = repos.map(r => ({
      id: `repo-${r.id}`,
      group: "Repositories",
      label: r.full_name,
      hint: r.language || undefined,
      action: go(`/repos/${r.id}`),
      keywords: `${r.full_name} ${r.description || ""} ${r.language || ""}`,
    }));
    return [...base, ...repoCommands];
  }, [repos, router, close]);

  // Filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => {
      const haystack = `${c.label} ${c.group} ${c.keywords || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [commands, query]);

  // Group for display
  const grouped = useMemo(() => {
    const map: Record<string, Command[]> = {};
    filtered.forEach(c => { (map[c.group] ||= []).push(c); });
    return Object.entries(map);
  }, [filtered]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx(i => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        filtered[activeIdx]?.action();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, activeIdx]);

  // Clamp active index when filter changes
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  if (!open) return null;

  // Flat index mapping for keyboard nav
  let flatIdx = -1;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command menu"
      className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}
      tabIndex={-1}
    >
      <div className="card shadow-card-hover w-full max-w-xl overflow-hidden animate-scale-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b border-surface-border">
          <svg className="w-4 h-4 text-text-muted shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="9" cy="9" r="6" />
            <path d="M17 17l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search repos, pages, actions…"
            className="flex-1 py-4 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none text-sm"
            aria-autocomplete="list"
            aria-controls="command-listbox"
            aria-activedescendant={filtered[activeIdx] ? `cmd-${filtered[activeIdx].id}` : undefined}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id="command-listbox"
          role="listbox"
          className="max-h-[60vh] overflow-y-auto py-2"
        >
          {filtered.length === 0 ? (
            <li className="text-center text-text-muted text-sm py-8">
              No matches for <span className="font-mono text-text-secondary">{query}</span>
            </li>
          ) : (
            grouped.map(([group, items]) => (
              <li key={group}>
                <p className="section-heading px-3 py-1.5">{group}</p>
                <ul>
                  {items.map(c => {
                    flatIdx++;
                    const isActive = flatIdx === activeIdx;
                    const myIdx = flatIdx;
                    return (
                      <li
                        key={c.id}
                        id={`cmd-${c.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-idx={myIdx}
                        onMouseEnter={() => setActiveIdx(myIdx)}
                        onClick={c.action}
                        // Listbox-pattern keyboard nav happens at the input level
                        // (arrows/Enter). This handler is just to satisfy the
                        // lint rule; the listbox parent owns the real shortcuts.
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); c.action(); } }}
                        className={`mx-2 px-3 py-2 rounded-md cursor-pointer flex items-center justify-between gap-3 text-sm transition-colors ${isActive ? "bg-accent/15 text-text-primary" : "text-text-secondary"}`}
                      >
                        <span className="truncate">{c.label}</span>
                        {c.hint && <span className="text-xs text-text-muted shrink-0">{c.hint}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        {/* Footer hints */}
        <div className="border-t border-surface-border px-4 py-2.5 flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><kbd className="kbd">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1.5"><kbd className="kbd">↵</kbd> select</span>
          </div>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">⌘</kbd><kbd className="kbd">K</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}
