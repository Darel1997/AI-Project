"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-text-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-surface-border px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm">
            RI
          </div>
          <span className="text-lg font-semibold">RepoInsight AI</span>
        </div>
        <a href="/auth" className="btn-primary text-sm">
          Get Started
        </a>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="max-w-3xl space-y-8">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
            Understand your codebase
            <br />
            <span className="text-accent">with AI</span>
          </h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed">
            Connect your GitHub repos. Chat with your code. Generate docs,
            detect tech debt, and create engineering tasks — all powered by
            RAG and GPT-4o.
          </p>
          <div className="flex gap-4 justify-center">
            <a href="/auth" className="btn-primary text-base px-6 py-3">
              Start Free
            </a>
            <a href="#features" className="btn-secondary text-base px-6 py-3">
              See Features
            </a>
          </div>
        </div>

        {/* Feature grid */}
        <div
          id="features"
          className="mt-24 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl w-full"
        >
          {[
            {
              title: "Chat with Code",
              desc: "Ask questions about any file, function, or pattern. Get answers with file citations.",
              icon: "💬",
            },
            {
              title: "Auto Documentation",
              desc: "Generate README sections, architecture overviews, and module docs from raw source.",
              icon: "📄",
            },
            {
              title: "Tech Debt Scanner",
              desc: "Detect code smells, complexity hotspots, missing tests, and stale dependencies.",
              icon: "🔍",
            },
            {
              title: "Task Generator",
              desc: "Produce Jira-style tickets with priority, difficulty, and suggested files to modify.",
              icon: "📋",
            },
            {
              title: "Analytics Dashboard",
              desc: "Visualize commit frequency, contributor load, language breakdown, and health scores.",
              icon: "📊",
            },
            {
              title: "GitHub Integration",
              desc: "One-click import. OAuth login. Automatic file syncing and branch detection.",
              icon: "🔗",
            },
          ].map((f) => (
            <div key={f.title} className="card p-6 text-left space-y-3">
              <span className="text-3xl">{f.icon}</span>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-border px-6 py-6 text-center text-text-muted text-sm">
        Built with Next.js, FastAPI, PostgreSQL, ChromaDB, and OpenAI
      </footer>
    </div>
  );
}
