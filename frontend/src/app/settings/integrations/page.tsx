"use client";

/**
 * Settings → Integrations.
 *
 * Currently surfaces Slack. As we add more integrations (Linear, Jira, Notion),
 * each gets a card here.
 *
 * For Slack, the flow is:
 *   1. User clicks "Connect Slack" → opens slack.com OAuth consent
 *   2. Slack redirects back to /api/slack/oauth/callback?code=…&state=<user_id>
 *   3. Backend exchanges code for bot token, stores it
 *   4. User returns here and sees "Connected" with team name
 *   5. User can then bind individual channels to repos via the per-repo settings
 *      (or via /repoinsight pick directly in Slack)
 */

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/ui/Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { request, API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface SlackStatus {
  connected: boolean;
  team_id?: string;
  team_name?: string;
  install_url?: string;
}

function IntegrationsContent() {
  const { user } = useAuth();
  const params = useSearchParams();
  const toast = useToast();
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);

  useEffect(() => {
    request<SlackStatus>("/api/slack/status")
      .then(setSlackStatus)
      .catch(() => setSlackStatus({ connected: false }));
  }, []);

  // After OAuth redirect, Slack appends ?slack=connected — show a toast
  useEffect(() => {
    if (params?.get("slack") === "connected") {
      toast.success("Slack connected", "Use /repoinsight in any channel.");
    }
  }, [params, toast]);

  function connectSlack() {
    if (!slackStatus?.install_url) {
      toast.error("Slack not configured", "Set SLACK_CLIENT_ID + SLACK_CLIENT_SECRET in the backend env.");
      return;
    }
    if (!user) return;
    // Pass user_id as state so the backend can attribute the workspace install
    const url = `${slackStatus.install_url}&state=${user.id}`;
    window.location.href = url;
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <main className="flex-1 ml-64 px-8 py-10">
        <div className="max-w-3xl mx-auto space-y-8">
          <header>
            <p className="eyebrow text-accent mb-2">Settings</p>
            <h1 className="text-2xl font-bold">Integrations</h1>
            <p className="text-text-secondary text-sm mt-1">
              Connect RepoInsight to the tools your team already uses.
            </p>
          </header>

          {/* Slack card */}
          <div className="card p-6 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-violet to-accent flex items-center justify-center shrink-0">
                {/* Slack-style four-color logo would require their brand asset; using a hash mark instead to avoid IP issues */}
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M5 12a2 2 0 110-4h2v4H5zm5 0V8a2 2 0 114 0v4h-4zm9 5a2 2 0 110 4h-2v-4h2zm-5 0v4a2 2 0 11-4 0v-4h4zm-9-5h4v4H5a2 2 0 110-4zm12 0h-4V8a2 2 0 114 0v4zM12 5a2 2 0 11-4 0V3a2 2 0 114 0v2zm0 14a2 2 0 11-4 0v-2a2 2 0 014 0v2z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold">Slack</h3>
                  {slackStatus?.connected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald/30 bg-emerald-subtle text-emerald text-[10px] font-bold uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald" />
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary mt-1 leading-relaxed">
                  Ask questions about your codebase directly from Slack. Use{" "}
                  <code className="font-mono text-text-primary text-xs bg-surface-overlay px-1.5 py-0.5 rounded">/repoinsight</code>{" "}
                  in any channel, or @-mention the bot in a thread.
                </p>
                {slackStatus?.connected && slackStatus.team_name && (
                  <p className="text-xs text-text-muted mt-2">
                    Connected workspace: <span className="text-text-primary font-medium">{slackStatus.team_name}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Setup instructions / Connect button */}
            {slackStatus === null ? (
              <div className="skeleton h-9 w-32" />
            ) : slackStatus.connected ? (
              <div className="bg-surface-overlay border border-white/5 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-text-secondary">Quick start in Slack:</p>
                <ul className="text-xs text-text-muted space-y-1.5 leading-relaxed">
                  <li>
                    <code className="font-mono text-accent">/repoinsight repos</code> — list your indexed repos
                  </li>
                  <li>
                    <code className="font-mono text-accent">/repoinsight pick owner/repo</code> — bind this channel to a repo
                  </li>
                  <li>
                    <code className="font-mono text-accent">/repoinsight ask &quot;how does billing work?&quot;</code> — get a real answer with citations
                  </li>
                  <li>
                    <code className="font-mono text-accent">@repoinsight</code> in any thread — get a reply right where the conversation is happening
                  </li>
                </ul>
              </div>
            ) : (
              <div className="space-y-3">
                <button onClick={connectSlack} className="btn-primary text-sm inline-flex items-center gap-2">
                  Connect Slack
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M7 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {!slackStatus.install_url && (
                  <p className="text-xs text-text-muted">
                    The Slack app isn&apos;t configured yet on this RepoInsight instance. Set{" "}
                    <code className="font-mono">SLACK_CLIENT_ID</code>,{" "}
                    <code className="font-mono">SLACK_CLIENT_SECRET</code>, and{" "}
                    <code className="font-mono">SLACK_SIGNING_SECRET</code> in the backend environment, then restart.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Coming soon — visible placeholder so users know what's planned */}
          <div className="card p-6 space-y-3 opacity-60">
            <h3 className="font-semibold text-sm">More integrations</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Linear, Jira, Notion, and Microsoft Teams are on the roadmap. Tell us which one matters most:
            </p>
            <Link href="/enterprise" className="text-xs text-accent hover:text-accent-hover">
              Request an integration →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <IntegrationsContent />
    </Suspense>
  );
}
