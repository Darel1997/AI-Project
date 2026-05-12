"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { repos as reposApi, chat as chatApi, Repo, ChatMessage, ChatSource } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

const SUGGESTED_PROMPTS = [
  { q: "How is authentication implemented?", category: "Architecture" },
  { q: "What are the main entry points?", category: "Architecture" },
  { q: "Explain the database schema", category: "Data" },
  { q: "Where is the API routing defined?", category: "Architecture" },
  { q: "Find potential security issues", category: "Security" },
  { q: "Which files have the most complexity?", category: "Quality" },
  { q: "What tests exist and what's missing coverage?", category: "Quality" },
  { q: "Summarize the key abstractions", category: "Architecture" },
];

function ChatContent() {
  const params = useSearchParams();
  const toast = useToast();
  const initialRepoId = params.get("repo");

  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedRepoData = repoList.find(r => r.id === selectedRepo);

  // Load repos + restore last selection
  useEffect(() => {
    reposApi.list().then(d => {
      const indexed = d.repos.filter(r => r.is_indexed);
      setRepoList(indexed);
      let target: number | null = null;
      if (initialRepoId) target = Number(initialRepoId);
      else {
        const saved = typeof window !== "undefined" ? localStorage.getItem("ri:lastChatRepo") : null;
        if (saved) target = Number(saved);
      }
      if (target && indexed.some(r => r.id === target)) setSelectedRepo(target);
    });
  }, [initialRepoId]);

  useEffect(() => {
    if (selectedRepo) localStorage.setItem("ri:lastChatRepo", String(selectedRepo));
  }, [selectedRepo]);

  useEffect(() => {
    if (selectedRepo) {
      chatApi.history(selectedRepo)
        .then(page => setMessages(page.messages))
        .catch(() => {});
    }
  }, [selectedRepo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  // Focus shortcut: `/` to focus chat input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key === "/" && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA" && !t.isContentEditable) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !selectedRepo || sending) return;
    const userMsg = input.trim();
    setInput("");
    setSending(true);

    setMessages(p => [...p, {
      id: Date.now(),
      role: "user",
      content: userMsg,
      created_at: new Date().toISOString(),
    }]);

    try {
      const response = await chatApi.send(selectedRepo, userMsg);
      setMessages(p => [...p, {
        id: response.message_id,
        role: "assistant",
        content: response.answer,
        sources: response.sources,
        created_at: new Date().toISOString(),
      }]);
    } catch (err: any) {
      toast.error("Couldn't get answer", err.message);
      setMessages(p => [...p, {
        id: Date.now(),
        role: "assistant",
        content: `Sorry, something went wrong. ${err.message}`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
    }
  }, [input, selectedRepo, sending, toast]);

  // Cmd/Ctrl + Enter to send
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 mb-5 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chat with repo</h1>
          {selectedRepoData && (
            <p className="text-text-muted text-sm mt-0.5">
              Asking questions about <span className="text-text-secondary font-mono text-xs">{selectedRepoData.full_name}</span>
            </p>
          )}
        </div>
        <div className="relative">
          <select
            value={selectedRepo || ""}
            onChange={e => { setSelectedRepo(Number(e.target.value) || null); setMessages([]); }}
            className="input text-sm w-64 appearance-none pr-9 cursor-pointer"
            aria-label="Select a repository"
          >
            <option value="">Select a repository…</option>
            {repoList.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
          </select>
          <svg className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-5 pr-2 -mr-2" role="log" aria-live="polite" aria-relevant="additions">
        {!selectedRepo ? (
          <EmptyNoRepo hasRepos={repoList.length > 0} />
        ) : messages.length === 0 && !sending ? (
          <EmptyFirstQuestion onPromptClick={(q) => { setInput(q); textareaRef.current?.focus(); }} />
        ) : (
          messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              repoId={selectedRepo!}
              animate={msg.id > Date.now() - 5000}
            />
          ))
        )}
        {sending && <ThinkingBubble />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={e => { e.preventDefault(); handleSend(); }}
        className="mt-4 shrink-0"
      >
        <div className="relative card p-3 focus-within:border-accent/50 focus-within:shadow-glow-sm transition-all">
          <label htmlFor="chat-input" className="sr-only">
            {selectedRepo ? "Ask about your codebase" : "Select a repo first"}
          </label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={selectedRepo ? "Ask about your codebase… (⌘+Enter to send)" : "Select a repo first"}
            disabled={!selectedRepo || sending}
            rows={1}
            className="w-full resize-none bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none text-sm disabled:opacity-60 max-h-[200px]"
            aria-busy={sending}
          />
          <div className="flex items-center justify-between pt-2 border-t border-surface-border/50 mt-2">
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">/</kbd> focus
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">⌘</kbd><kbd className="kbd">↵</kbd> send
              </span>
            </div>
            <button
              type="submit"
              disabled={!selectedRepo || !input.trim() || sending}
              className="btn-primary text-sm px-4 py-1.5"
              aria-label="Send message"
            >
              {sending ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" aria-hidden="true" />
                  Thinking…
                </>
              ) : (
                <>
                  Send
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M3 10h14M10 3l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */

function EmptyNoRepo({ hasRepos }: { hasRepos: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-20 space-y-5 animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-accent-subtle flex items-center justify-center">
        <svg className="w-7 h-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">Pick a repository to start chatting</h2>
        <p className="text-text-secondary text-sm max-w-sm">
          {hasRepos
            ? "Use the dropdown above to choose an indexed repo."
            : "Import a repo from the dashboard first, then come back to chat."}
        </p>
      </div>
    </div>
  );
}

function EmptyFirstQuestion({ onPromptClick }: { onPromptClick: (q: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-12 space-y-6 animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/30 to-accent-muted/20 flex items-center justify-center ring-1 ring-accent/20">
        <svg className="w-7 h-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <div className="space-y-1.5 max-w-md">
        <h2 className="text-xl font-semibold">Ask anything about your code</h2>
        <p className="text-text-secondary text-sm leading-relaxed">
          Answers are grounded in your actual source — every reply cites the files and line ranges it drew from.
        </p>
      </div>
      <div className="w-full max-w-2xl">
        <p className="section-heading mb-3">Try one of these</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SUGGESTED_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => onPromptClick(p.q)}
              className="card-hover text-left p-3 group"
            >
              <p className="text-xs text-text-muted mb-0.5">{p.category}</p>
              <p className="text-sm text-text-primary group-hover:text-accent transition-colors">{p.q}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, repoId, animate }: { msg: ChatMessage; repoId: number; animate: boolean }) {
  const isUser = msg.role === "user";
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} ${animate ? "animate-slide-up" : ""}`}>
      <div className={`max-w-[85%] ${isUser ? "" : "w-full sm:w-auto"}`}>
        <div
          className={
            isUser
              ? "text-white rounded-2xl rounded-br-md px-4 py-3 shadow-glow-sm"
              : "card-glass rounded-2xl rounded-bl-md px-4 py-3"
          }
          style={isUser ? { background: "linear-gradient(135deg, #7c6bff 0%, #6151f0 100%)" } : undefined}
        >
          <p className="text-sm whitespace-pre-wrap leading-relaxed text-pretty">{msg.content}</p>
          {msg.sources && msg.sources.length > 0 && <SourceList sources={msg.sources} />}
        </div>
        <p className={`text-[10px] text-text-muted mt-1 px-1 ${isUser ? "text-right" : "text-left"}`}>
          {time}
        </p>
      </div>
    </div>
  );
}

function SourceList({ sources }: { sources: ChatSource[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, 3);

  return (
    <div className="mt-3 pt-3 border-t border-surface-border/50 space-y-1.5">
      <p className="section-heading">Sources · {sources.length}</p>
      {visible.map((s, i) => (
        <div
          key={i}
          className="group text-xs font-mono bg-surface/50 hover:bg-surface px-2.5 py-1.5 rounded-md text-text-secondary flex items-center gap-2 border border-transparent hover:border-surface-border transition-all"
        >
          <span className="text-accent shrink-0" aria-hidden="true">●</span>
          <span className="truncate flex-1">{s.file_path}</span>
          <span className="text-text-muted text-[10px] shrink-0">
            {Math.round(s.relevance * 100)}%
          </span>
        </div>
      ))}
      {sources.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent hover:text-accent-hover transition-colors mt-1"
        >
          {expanded ? "Show fewer" : `Show ${sources.length - 3} more`}
        </button>
      )}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="card rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2.5">
        <div className="flex gap-1 items-center">
          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" />
          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
        <span className="text-xs text-text-muted">Searching your codebase…</span>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center p-12">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Loading chat" />
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
