"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  repos as reposApi,
  chat as chatApi,
  Repo,
  ChatMessage,
  ChatSource,
} from "@/lib/api";

function ChatContent() {
  const params = useSearchParams();
  const initialRepoId = params.get("repo");

  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<number | null>(
    initialRepoId ? Number(initialRepoId) : null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    reposApi.list().then((d) => {
      setRepoList(d.repos.filter((r) => r.is_indexed));
    });
  }, []);

  useEffect(() => {
    if (selectedRepo) {
      chatApi.history(selectedRepo).then(setMessages).catch(() => {});
    }
  }, [selectedRepo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !selectedRepo || sending) return;

    const userMsg = input.trim();
    setInput("");
    setSending(true);

    // optimistic user message
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: "user",
        content: userMsg,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const response = await chatApi.send(selectedRepo, userMsg);
      setMessages((prev) => [
        ...prev,
        {
          id: response.message_id,
          role: "assistant",
          content: response.answer,
          sources: response.sources,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "assistant",
          content: `Error: ${err.message}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-4xl h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Chat with Code</h1>
        <select
          value={selectedRepo || ""}
          onChange={(e) => {
            setSelectedRepo(Number(e.target.value) || null);
            setMessages([]);
          }}
          className="input text-sm w-64"
        >
          <option value="">Select a repository...</option>
          {repoList.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {!selectedRepo ? (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            Select a repository to start chatting
          </div>
        ) : messages.length === 0 && !sending ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 py-20">
            <div className="text-4xl">◈</div>
            <p className="text-text-secondary">
              Ask anything about your codebase
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {[
                "How is authentication implemented?",
                "What design patterns are used?",
                "Explain the database schema",
                "Where are the API routes defined?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="text-xs bg-surface-overlay hover:bg-surface-border border border-surface-border px-3 py-1.5 rounded-full transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-accent text-white rounded-br-md"
                    : "card rounded-bl-md"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </p>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-surface-border/30 space-y-1">
                    <p className="text-xs text-text-muted font-medium">
                      Sources:
                    </p>
                    {(msg.sources as ChatSource[]).slice(0, 4).map((s, i) => (
                      <div
                        key={i}
                        className="text-xs font-mono bg-surface/30 px-2 py-1 rounded text-text-secondary"
                      >
                        {s.file_path}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="card rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="mt-4 flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            selectedRepo
              ? "Ask about your codebase..."
              : "Select a repo first"
          }
          disabled={!selectedRepo || sending}
          className="input flex-1"
        />
        <button
          type="submit"
          disabled={!selectedRepo || !input.trim() || sending}
          className="btn-primary disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={<div className="text-text-muted p-8">Loading chat...</div>}
    >
      <ChatContent />
    </Suspense>
  );
}
