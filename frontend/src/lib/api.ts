// Exported for pages that build their own fetch calls (e.g. /insights, /settings/integrations).
// Most callers should reach for the typed helper modules below (`auth`, `repos`, `chat`, …).
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Network-error matcher. `fetch()` throws different messages on different
 * runtimes — Chrome says "Failed to fetch", Firefox says "NetworkError when
 * attempting to fetch resource", Safari says "Load failed", and Node.js (used
 * by Next.js for SSR) emits "fetch failed" or "ECONNREFUSED". We treat all of
 * them as the same transient-network condition.
 */
function isTransientNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|load failed|fetch failed|econnrefused|enotfound|timeout/i
    .test(message || "");
}

/** A friendly, actionable error string for "the backend is unreachable". */
function backendUnreachableMessage(): string {
  return (
    `Cannot reach the API server at ${API_URL}. The backend may be starting up or crashed. ` +
    `Run "docker compose logs api --tail 50" or visit ${API_URL}/health/detail to see what's wrong.`
  );
}

/** Whether a request method is safe to retry without side effects. */
function isIdempotent(method: string | undefined): boolean {
  const m = (method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Retry transient network failures (container cold-start, brief restarts) on
  // idempotent requests only — POSTs that mutate server state must NOT be retried
  // because we can't tell whether the original request succeeded.
  const maxAttempts = isIdempotent(options.method) ? 3 : 1;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, { ...options, headers });
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message || "";
      if (isTransientNetworkError(msg) && attempt < maxAttempts) {
        // 250ms → 500ms backoff. Plenty for a Docker container that's mid-restart.
        await sleep(250 * attempt);
        continue;
      }
      throw new Error(isTransientNetworkError(msg) ? backendUnreachableMessage() : `Network error: ${msg || "unknown"}`);
    }

    if (res.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        window.location.href = "/auth";
      }
      throw new Error("Unauthorized");
    }
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      // Retry 502/503/504 on idempotent requests — these are "server is restarting"
      // signals from a load balancer or sidecar, not application errors.
      if ([502, 503, 504].includes(res.status) && attempt < maxAttempts) {
        await sleep(250 * attempt);
        continue;
      }
      const body = await res.json().catch(() => ({}));
      // FastAPI's `detail` can be a string OR an object (we use objects for structured
      // errors like 402 Payment Required). Normalize to a string so callers can show it.
      let message: string;
      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (body.detail && typeof body.detail === "object") {
        message = body.detail.message || JSON.stringify(body.detail);
      } else {
        message = `Request failed: ${res.status}`;
      }
      const err: any = new Error(message);
      err.status = res.status;
      err.detail = body.detail;
      throw err;
    }
    return res.json();
  }

  // Defensive: every loop branch above either returns or throws. If we reach
  // here, something is very wrong — surface the last underlying error.
  throw new Error(
    lastErr && isTransientNetworkError(lastErr.message || "") ? backendUnreachableMessage() : `Request failed: ${lastErr?.message || "unknown"}`
  );
}

/* ────────────────────────────────────────────────────────────────────
   Health check
   ────────────────────────────────────────────────────────────────────
   Lightweight, no-auth ping used by the frontend to detect whether the
   backend is reachable BEFORE the user clicks something that requires it.
   Has its own short timeout so a hung backend doesn't lock the UI. */

export type HealthState = "ok" | "down" | "starting";

export async function checkHealth(timeoutMs = 3000): Promise<HealthState> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${API_URL}/health`, {
      method: "GET",
      signal: ctrl?.signal,
      // No credentials, no auth — health is public. Some browsers cache GETs
      // aggressively; bust it so a "starting → ok" transition is visible.
      cache: "no-store",
      headers: { "Accept": "application/json" },
    });
    if (res.ok) return "ok";
    // 502/503/504 means a proxy is up but the upstream isn't ready yet.
    if ([502, 503, 504].includes(res.status)) return "starting";
    return "down";
  } catch {
    return "down";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Auth ──────────────────────────────────────────────
export const auth = {
  register: (data: { email: string; password: string; full_name?: string }) =>
    request<AuthResponse>("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    request<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),
  githubUrl: () => request<{ url: string }>("/api/auth/github/url"),
  githubStatus: () => request<{ configured: boolean }>("/api/auth/github/status"),
  githubCallback: (code: string) =>
    request<AuthResponse>("/api/auth/github/callback", { method: "POST", body: JSON.stringify({ code }) }),
  me: () => request<User>("/api/auth/me"),
  updateProfile: (data: { full_name?: string }) =>
    request<User>("/api/auth/me", { method: "PATCH", body: JSON.stringify(data) }),
  changePassword: (data: { current_password: string; new_password: string }) =>
    request<{ message: string }>("/api/auth/change-password", { method: "POST", body: JSON.stringify(data) }),
  deleteAccount: () => request<void>("/api/auth/me", { method: "DELETE" }),
};

// ── Repos ─────────────────────────────────────────────
export const repos = {
  list: () => request<RepoListResponse>("/api/repos/"),
  get: (id: number) => request<Repo>(`/api/repos/${id}`),
  import: (url: string) =>
    request<Repo>("/api/repos/import", { method: "POST", body: JSON.stringify({ github_repo_url: url }) }),
  reindex: (id: number) =>
    request<{ message: string }>(`/api/repos/${id}/reindex`, { method: "POST" }),
  delete: (id: number) =>
    request<void>(`/api/repos/${id}`, { method: "DELETE" }),

  // Webhook integration
  webhookStatus: (id: number) =>
    request<WebhookStatus>(`/api/repos/${id}/webhook/status`),
  webhookEnable: (id: number) =>
    request<WebhookEnableResponse>(`/api/repos/${id}/webhook/enable`, { method: "POST" }),
  webhookDisable: (id: number) =>
    request<{ enabled: false }>(`/api/repos/${id}/webhook/disable`, { method: "POST" }),
  webhookRotateSecret: (id: number) =>
    request<{ secret: string }>(`/api/repos/${id}/webhook/rotate-secret`, { method: "POST" }),
};

export interface WebhookStatus {
  enabled: boolean;
  has_secret: boolean;
  webhook_url: string | null;
  last_triggered_at: string | null;
  reindex_count: number;
}

export interface WebhookEnableResponse {
  enabled: boolean;
  webhook_url: string;
  secret: string;
  content_type: string;
  events: string[];
  instructions: string;
}

// ── Chat ──────────────────────────────────────────────
export const chat = {
  send: (repoId: number, message: string) =>
    request<ChatResponse>("/api/chat/send", { method: "POST", body: JSON.stringify({ repository_id: repoId, message }) }),
  history: (repoId: number) =>
    request<ChatMessage[]>(`/api/chat/history/${repoId}`),
};

// ── AI ────────────────────────────────────────────────
export const ai = {
  explainFile: (repoId: number, filePath: string) =>
    request<ExplainResponse>("/api/ai/explain", { method: "POST", body: JSON.stringify({ repository_id: repoId, file_path: filePath }) }),

  // Docs (cached)
  getDocs: (repoId: number) => request<CachedDocs>(`/api/ai/docs/${repoId}`),
  generateDocs: (repoId: number) =>
    request<DocsResponse>("/api/ai/docs", { method: "POST", body: JSON.stringify({ repository_id: repoId }) }),

  // Code Quality Audit (cached) — formerly "tech-debt"
  getAudit: (repoId: number) => request<CachedAudit>(`/api/ai/audit/${repoId}`),
  runAudit: (repoId: number) =>
    request<TechDebtResponse>("/api/ai/audit", { method: "POST", body: JSON.stringify({ repository_id: repoId }) }),

  // Security scan (cached)
  getSecurity: (repoId: number) => request<SecurityResponse>(`/api/ai/security/${repoId}`),
  runSecurity: (repoId: number) =>
    request<SecurityResponse>("/api/ai/security", { method: "POST", body: JSON.stringify({ repository_id: repoId }) }),

  // Onboarding guide (cached)
  getOnboarding: (repoId: number) => request<OnboardingResponse>(`/api/ai/onboarding/${repoId}`),
  generateOnboarding: (repoId: number) =>
    request<OnboardingResponse>("/api/ai/onboarding", { method: "POST", body: JSON.stringify({ repository_id: repoId }) }),

  // Architecture diagram (cached, Mermaid)
  getArchitecture: (repoId: number) => request<ArchitectureResponse>(`/api/ai/architecture/${repoId}`),
  generateArchitecture: (repoId: number) =>
    request<ArchitectureResponse>("/api/ai/architecture", { method: "POST", body: JSON.stringify({ repository_id: repoId }) }),

  // Legacy
  techDebt: (repoId: number) =>
    request<TechDebtResponse>("/api/ai/audit", { method: "POST", body: JSON.stringify({ repository_id: repoId }) }),
};

// ── Tasks ─────────────────────────────────────────────
export const tasks = {
  generate: (repoId: number, focusArea?: string, count?: number) =>
    request<TaskItem[]>("/api/tasks/generate", {
      method: "POST", body: JSON.stringify({ repository_id: repoId, focus_area: focusArea, count: count || 5 }),
    }),
  list: (repoId: number) => request<TaskItem[]>(`/api/tasks/${repoId}`),
  updateStatus: (taskId: number, status: string) =>
    request<TaskItem>(`/api/tasks/update/${taskId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  remove: (taskId: number) =>
    request<void>(`/api/tasks/delete/${taskId}`, { method: "DELETE" }),
  clearAll: (repoId: number) =>
    request<void>(`/api/tasks/clear/${repoId}`, { method: "DELETE" }),
};

// ── Analytics ─────────────────────────────────────────
export const analytics = {
  get: (repoId: number) => request<AnalyticsData>(`/api/analytics/${repoId}`),
};

// ── Organizations ─────────────────────────────────────
export const orgs = {
  list: () => request<OrgSummary[]>("/api/orgs/"),
  get: (id: number) => request<OrgDetail>(`/api/orgs/${id}`),
  create: (name: string, description?: string) =>
    request<OrgSummary>("/api/orgs/", { method: "POST", body: JSON.stringify({ name, description }) }),
  update: (id: number, patch: { name?: string; description?: string }) =>
    request<OrgSummary>(`/api/orgs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  delete: (id: number) =>
    request<void>(`/api/orgs/${id}`, { method: "DELETE" }),

  invite: (orgId: number, email: string, role: "owner" | "admin" | "member" = "member") =>
    request<PendingInvitation>(`/api/orgs/${orgId}/invitations`, { method: "POST", body: JSON.stringify({ email, role }) }),
  listInvitations: (orgId: number) =>
    request<PendingInvitation[]>(`/api/orgs/${orgId}/invitations`),
  revokeInvitation: (orgId: number, invId: number) =>
    request<void>(`/api/orgs/${orgId}/invitations/${invId}`, { method: "DELETE" }),
  getInvitation: (token: string) =>
    request<InvitationInfo>(`/api/orgs/invitations/${token}`),
  acceptInvitation: (token: string) =>
    request<OrgSummary>(`/api/orgs/invitations/${token}/accept`, { method: "POST" }),
  declineInvitation: (token: string) =>
    request<void>(`/api/orgs/invitations/${token}/decline`, { method: "POST" }),

  changeRole: (orgId: number, userId: number, role: "owner" | "admin" | "member") =>
    request<OrgMember>(`/api/orgs/${orgId}/members/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (orgId: number, userId: number) =>
    request<void>(`/api/orgs/${orgId}/members/${userId}`, { method: "DELETE" }),
};

export interface OrgSummary {
  id: number; name: string; slug: string; description?: string; avatar_url?: string;
  is_personal: boolean; plan: string; seats: number; member_count: number; my_role: "owner" | "admin" | "member";
}
export interface OrgMember {
  user_id: number; email: string; full_name?: string; avatar_url?: string;
  role: "owner" | "admin" | "member"; joined_at: string;
}
export interface OrgDetail {
  id: number; name: string; slug: string; description?: string; avatar_url?: string;
  is_personal: boolean; plan: string; seats: number; my_role: "owner" | "admin" | "member";
  members: OrgMember[];
}
export interface PendingInvitation {
  id: number; email: string; role: string; expires_at: string; created_at: string;
}
export interface InvitationInfo {
  org_name: string; org_slug: string; email: string; role: string; expires_at: string;
}

// ── Types ─────────────────────────────────────────────
export interface User { id: number; email: string; full_name?: string; avatar_url?: string; github_username?: string; created_at: string; }
export interface AuthResponse { access_token: string; token_type: string; user: User; }
export interface Repo { id: number; full_name: string; name: string; description?: string; language?: string; stars: number; forks: number; is_indexed: boolean; index_status: string; total_files: number; indexed_files: number; health_score?: number; language_breakdown?: Record<string, number>; total_commits: number; total_contributors: number; total_lines: number; created_at: string; default_branch?: string; open_issues?: number; }
export interface RepoListResponse { repos: Repo[]; total: number; }
export interface ChatSource { file_path: string; snippet: string; relevance: number; }
export interface ChatResponse { answer: string; sources: ChatSource[]; message_id: number; }
export interface ChatMessage { id: number; role: string; content: string; sources?: ChatSource[]; created_at: string; }
export interface ExplainResponse { file_path: string; explanation: string; language?: string; line_count: number; }
export interface DocsResponse { documentation: string; files_analyzed: number; }
export interface TechDebtItem { file_path: string; issue: string; severity: string; category: string; suggestion: string; }
export interface TechDebtResponse { items: TechDebtItem[]; summary: string; overall_score: number; }
export interface CachedDocs { documentation?: string; files_analyzed: number; generated_at?: string; }
export interface CachedAudit { items?: TechDebtItem[]; summary?: string; overall_score?: number; generated_at?: string; }
export interface SecurityFinding { file_path: string; line_hint?: string; vulnerability: string; severity: string; cwe?: string; description: string; remediation: string; }
export interface SecurityResponse { findings: SecurityFinding[]; summary: string; security_score: number; generated_at?: string; }
export interface OnboardingResponse { guide?: string; generated_at?: string; }
export interface ArchitectureResponse { diagram?: string; generated_at?: string; }
export interface TaskItem { id: number; title: string; description: string; priority: string; difficulty: string; task_type: string; suggested_files?: string[]; status: string; created_at: string; }
export interface CommitActivity { date: string; count: number; }
export interface ContributorStat { username: string; avatar_url?: string; commits: number; additions: number; deletions: number; }
export interface AnalyticsData { health_score: number; total_commits: number; total_contributors: number; total_lines: number; language_breakdown: Record<string, number>; commit_activity: CommitActivity[]; top_contributors: ContributorStat[]; }

// ── Billing ────────────────────────────────────────────
export const billing = {
  getSubscription: () => request<SubscriptionView>("/api/billing/subscription"),
  getFeatures: () => request<FeatureCatalog>("/api/billing/features"),
  createCheckout: (tier: "pro" | "team" | "business", billing_cycle: "monthly" | "annual", seat_count = 1) =>
    request<CheckoutResponse>("/api/billing/checkout/create-session", {
      method: "POST",
      body: JSON.stringify({ tier, billing_cycle, seat_count }),
    }),
  createPortal: () =>
    request<PortalResponse>("/api/billing/portal/create-session", { method: "POST" }),
};

export interface FeatureCatalogItem {
  slug: string;
  name: string;
  description: string;
  tier: "free" | "pro" | "team" | "business" | "enterprise" | "owner";
  unlocked: boolean;
}
export interface FeatureCatalog {
  current_tier: "free" | "pro" | "team" | "business" | "enterprise" | "owner";
  is_owner: boolean;
  features: FeatureCatalogItem[];
}

export interface SubscriptionView {
  tier: "free" | "pro" | "team" | "business" | "enterprise" | "owner";
  status: "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "incomplete" | "paused";
  billing_cycle?: "monthly" | "annual";
  seats: number;
  current_period_end?: string;
  cancel_at_period_end: boolean;
  limits: {
    repos: number;           // -1 = unlimited
    ai_messages_per_month: number;
    members: number;
    private_repos: boolean;
  };
}
export interface CheckoutResponse { checkout_url: string; session_id: string; mock?: boolean; }
export interface PortalResponse { portal_url: string; mock?: boolean; }

// ── Blast Radius ──────────────────────────────────────
export const blastRadius = {
  analyze: (body: BlastRadiusRequest) =>
    request<BlastRadiusReport>("/api/blast-radius/analyze", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export interface BlastRadiusRequest {
  repository_id: number;
  modified_files?: string[];
  pr_url?: string;
  diff_text?: string;
  change_description?: string;
}
export interface AffectedItem {
  path: string;
  kind: "file" | "test" | "deployment" | "doc";
  hops: number;
  reason: string;
  risk: "low" | "medium" | "high" | "critical";
  owners: string[];
  lines?: string;
}
export interface BlastRadiusReport {
  repository_id: number;
  summary: string;
  risk_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  affected: AffectedItem[];
  test_coverage_gap: string[];
  recommended_reviewers: string[];
  deployment_surfaces: string[];
  estimated_review_time_minutes: number;
  generated_at: string;
}

// ── Onboarding Simulator ────────────────────────────────
export const onboardingSim = {
  simulate: (body: OnboardingSimRequest) =>
    request<OnboardingPlan>("/api/onboarding-sim/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProgress: (repoId: number, checkpointId: string, completed: boolean, notes?: string) =>
    request<{ ok: boolean }>(`/api/onboarding-sim/progress/${repoId}/${checkpointId}`, {
      method: "POST",
      body: JSON.stringify({ checkpoint_id: checkpointId, completed, notes }),
    }),
};

export interface OnboardingSimRequest {
  repository_id: number;
  role?: "frontend" | "backend" | "fullstack" | "devops" | "data" | "ml" | "generalist";
  experience_level?: "junior" | "mid" | "senior";
  focus_areas?: string[];
}
export interface OnboardingCheckpoint {
  id: string; title: string; description: string;
  kind: "setup" | "reading" | "exploration" | "exercise" | "meeting";
  estimated_minutes: number;
  files: string[]; prs: string[]; issues: string[]; people: string[];
  completion_hint?: string;
}
export interface OnboardingPhase {
  name: "day_1" | "week_1" | "month_1";
  title: string; goal: string; estimated_hours: number;
  checkpoints: OnboardingCheckpoint[];
}
export interface OnboardingPlan {
  repository_id: number; repository_name: string;
  role: string; experience_level: string;
  summary: string; phases: OnboardingPhase[];
  tech_stack: string[]; key_abstractions: string[]; gotchas: string[];
  people_to_meet: string[]; first_pr_suggestions: Array<{ title: string; difficulty: string; file: string; why: string }>;
  generated_at: string;
}

// ── Tribal Knowledge Capture ────────────────────────────
export const tribalKnowledge = {
  capture: (repoId: number, contributor: string, includeDeepHistory = true) =>
    request<TribalKnowledgeDump>("/api/tribal-knowledge/capture", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, contributor, include_deep_history: includeDeepHistory }),
    }),
};

export interface OwnedArea {
  path: string; commits_by_target: number; total_commits: number;
  ownership_percent: number; last_touched?: string;
  risk_level: "low" | "medium" | "high" | "critical"; reason: string;
}
export interface UniqueKnowledge {
  title: string; description: string; evidence: string[]; successor_briefing: string;
}
export interface DecisionRecord {
  topic: string; choice_made: string; alternatives_considered: string[];
  rationale: string; files: string[];
}
export interface TribalKnowledgeDump {
  repository_id: number; repository_name: string; contributor: string;
  summary: string; bus_factor_impact: string;
  owned_areas: OwnedArea[]; unique_knowledge: UniqueKnowledge[]; decisions: DecisionRecord[];
  conventions_introduced: string[]; high_risk_files: string[];
  recommended_handoff_meetings: Array<{ with: string; topics: string[]; duration_minutes: number }>;
  generated_at: string;
}

// ── Dependency Health Radar ──────────────────────────────
export const dependencyRadar = {
  scan: (repoId: number, riskThreshold: "all" | "medium" | "high" | "critical" = "medium") =>
    request<DependencyRadarReport>("/api/dependency-radar/scan", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, include_dev_deps: true, risk_threshold: riskThreshold }),
    }),
};

export interface DependencyAlternative {
  name: string; fit_score: number; reasons: string[];
  migration_effort_hours: number; maintainer_health: "healthy" | "slowing" | "stale";
}
export interface DependencyFinding {
  name: string; current_version?: string; ecosystem: string;
  last_release_days_ago?: number;
  maintainer_health: "healthy" | "slowing" | "stale" | "abandoned" | "unknown";
  open_issues?: number; stars?: number;
  severity: "low" | "medium" | "high" | "critical";
  concerns: string[]; used_in_files: string[]; usage_surface: string;
  alternatives: DependencyAlternative[];
  recommended_action: "keep" | "monitor" | "plan-migration" | "replace-urgent";
  recommended_action_reason: string;
}
export interface DependencyRadarReport {
  repository_id: number; repository_name: string;
  summary: string; overall_health_score: number;
  critical_count: number; high_count: number; medium_count: number; low_count: number;
  findings: DependencyFinding[]; generated_at: string;
}

// ── Codebase Time Machine ────────────────────────────────
export const timeMachine = {
  replay: (repoId: number, path: string, lookbackMonths = 24) =>
    request<TimeMachineReport>("/api/time-machine/replay", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, path, lookback_months: lookbackMonths }),
    }),
};

export interface TimelineEvent {
  date: string;
  kind: "birth" | "refactor" | "incident" | "ownership-shift" | "major-feature" | "deprecation";
  title: string; description: string;
  actors: string[]; files_touched: number; related_commits: string[];
}
export interface TimeMachineMetricPoint {
  date: string; file_count: number; total_lines: number; contributor_count: number;
}
export interface TimeMachineReport {
  repository_id: number; repository_name: string; path: string; lookback_months: number;
  summary: string; events: TimelineEvent[];
  metric_series: TimeMachineMetricPoint[];
  ownership_snapshots: Array<{ date: string; top_contributors: Array<{ name: string; commits_pct: number }> }>;
  narrative: string; current_risks: string[]; generated_at: string;
}

// ── License Scanner ────────────────────────────────────────
export const licenseScanner = {
  scan: (repoId: number, projectLicense?: string) =>
    request<LicenseScanReport>("/api/license-scanner/scan", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, project_license: projectLicense }),
    }),
  // SBOM is a JSON document — we expose it as a download URL the user can fetch directly
  sbomUrl: (repoId: number) => `${API_URL}/api/license-scanner/sbom/${repoId}`,
};

export interface LicenseFinding {
  name: string;
  version?: string;
  ecosystem: string;
  license?: string;
  license_category: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  concerns: string[];
  repository_url?: string;
}
export interface LicenseScanReport {
  repository_id: number;
  repository_name: string;
  project_license?: string;
  project_license_category: string;
  summary: string;
  counts_by_severity: Record<string, number>;
  counts_by_category: Record<string, number>;
  findings: LicenseFinding[];
  sbom_spdx_url: string;
  generated_at: string;
}

// ── PR Reviewer ────────────────────────────────────────
export const prReviewer = {
  review: (repoId: number, prNumber: number) =>
    request<PRReview>("/api/pr-reviewer/review", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, pr_number: prNumber }),
    }),
  // Webhook URL the user adds to their GitHub repo settings
  webhookUrl: () => `${API_URL}/api/pr-reviewer/webhook`,
};

export interface PRReview {
  repository_id: number;
  pr_number: number;
  pr_title: string;
  risk_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  summary: string;
  files_changed: number;
  additions: number;
  deletions: number;
  affected_files: string[];
  test_coverage_gap: string[];
  new_dependencies: Array<{ name: string; version: string; ecosystem: string }>;
  deployment_surfaces: string[];
  posted_to_github: boolean;
  review_comment: string;
  generated_at: string;
}

// ── Compliance ────────────────────────────────────────
export const compliance = {
  generate: (repoId: number, framework: "soc2" | "gdpr" | "hipaa") =>
    request<ComplianceReport>("/api/compliance/report", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, framework }),
    }),
};

export interface ComplianceEvidence {
  pattern_id: string;
  category: string;
  file_path: string;
  line_number?: number;
  snippet: string;
}
export interface ControlAssessment {
  control_id: string;
  control_name: string;
  framework: string;
  status: "evidence_found" | "partial" | "not_found" | "manual_review";
  evidence_count: number;
  evidence: ComplianceEvidence[];
  summary: string;
  recommendation?: string;
}
export interface ComplianceReport {
  repository_id: number;
  repository_name: string;
  framework: string;
  framework_version: string;
  summary: string;
  overall_readiness_score: number;
  controls: ControlAssessment[];
  evidence_total: number;
  files_scanned: number;
  generated_at: string;
  disclaimer: string;
}

// ── Knowledge Graph ────────────────────────────────────────
export const knowledgeGraph = {
  search: (repoId: number, query: string, mode: "definitions" | "usages" | "concept" | "auto" = "auto", maxResults = 50) =>
    request<GraphSearchResult>("/api/knowledge-graph/search", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, query, mode, max_results: maxResults }),
    }),
};

export interface SymbolHit {
  file_path: string;
  line_number: number;
  snippet: string;
  kind: "definition" | "usage" | "import" | "mention";
  language?: string;
  confidence: number;
}
export interface GraphSearchResult {
  repository_id: number;
  repository_name: string;
  query: string;
  mode_used: string;
  summary: string;
  total_hits: number;
  files_with_hits: number;
  hits: SymbolHit[];
  related_symbols: string[];
  generated_at: string;
}

// ── Code Drift ────────────────────────────────────────
export const codeDrift = {
  check: (repoId: number, filePaths: string[], fileContents?: Record<string, string>) =>
    request<DriftReport>("/api/code-drift/check", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, file_paths: filePaths, file_contents: fileContents }),
    }),
};

export interface DriftViolation {
  file_path: string;
  pattern_id: string;
  pattern_name: string;
  description: string;
  severity: "info" | "low" | "medium" | "high";
  peer_dominance_pct: number;
  peer_examples: string[];
  suggested_fix?: string;
}
export interface DriftReport {
  repository_id: number;
  repository_name: string;
  summary: string;
  files_analyzed: number;
  peer_set_size: number;
  violations: DriftViolation[];
  drift_score: number;
  generated_at: string;
}

// ── ADRs ────────────────────────────────────────
export const adrs = {
  detect: (repoId: number, lookbackMonths = 6) =>
    request<ShiftDetectionResult>("/api/adrs/detect", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, lookback_months: lookbackMonths }),
    }),
  draft: (repoId: number, candidate: ShiftCandidate) =>
    request<any>(`/api/adrs/draft?repository_id=${repoId}`, {
      method: "POST",
      body: JSON.stringify(candidate),
    }),
  create: (data: any) =>
    request<ADRView>("/api/adrs/create", { method: "POST", body: JSON.stringify(data) }),
  list: (repoId: number) => request<ADRView[]>(`/api/adrs/${repoId}`),
};

export interface ShiftCandidate {
  kind: string;
  title: string;
  description: string;
  evidence_commits: string[];
  evidence_files: string[];
  confidence: number;
  detected_at: string;
}
export interface ShiftDetectionResult {
  repository_id: number;
  repository_name: string;
  summary: string;
  candidates: ShiftCandidate[];
  generated_at: string;
}
export interface ADRView {
  id: number;
  title: string;
  status: string;
  context?: string;
  decision?: string;
  consequences?: string;
  alternatives: string[];
  detection_kind?: string;
  created_at: string;
  decided_at?: string;
}

// ── Cost Forecaster ────────────────────────────────────────
export const costForecaster = {
  forecast: (repoId: number, proposedChanges?: Record<string, string>) =>
    request<CostForecast>("/api/cost-forecaster/forecast", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, proposed_changes: proposedChanges }),
    }),
};

export interface CostLineItem {
  file_path: string;
  resource_type: string;
  resource_name: string;
  instance_type?: string;
  quantity: number;
  unit_cost_monthly: number;
  total_cost_monthly: number;
  notes: string[];
}
export interface CostForecast {
  repository_id: number;
  repository_name: string;
  summary: string;
  current_monthly_cost: number;
  proposed_monthly_cost: number;
  delta_monthly: number;
  delta_pct?: number;
  line_items_current: CostLineItem[];
  line_items_proposed: CostLineItem[];
  unmatched_resources: string[];
  catalog_version: string;
  catalog_note: string;
  generated_at: string;
}

// ── Migration Assistant ────────────────────────────────────────
export const migrationAssistant = {
  detect: (repoId: number) =>
    request<DetectionResult>("/api/migration/detect", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId }),
    }),
  plan: (repoId: number, recipeId: string) =>
    request<MigrationPlan>("/api/migration/plan", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, recipe_id: recipeId }),
    }),
};

export interface AvailableMigration {
  recipe_id: string;
  name: string;
  target: string;
  files_affected: number;
  estimated_hours_total: number;
}
export interface DetectionResult {
  repository_id: number;
  repository_name: string;
  available_migrations: AvailableMigration[];
  generated_at: string;
}
export interface FilePlan {
  file_path: string;
  matches: number;
  complexity: "trivial" | "standard" | "complex" | "manual";
  estimated_minutes: number;
  sample_findings: { pattern: string; line: number; fix: string; complexity: string; matched_text: string }[];
}
export interface MigrationPhase {
  name: string;
  description: string;
  files: FilePlan[];
  estimated_hours: number;
}
export interface MigrationPlan {
  repository_id: number;
  repository_name: string;
  recipe_name: string;
  target: string;
  summary: string;
  total_files: number;
  estimated_hours_total: number;
  complexity_breakdown: Record<string, number>;
  phases: MigrationPhase[];
  risks: string[];
  rollback_strategy: string;
  generated_at: string;
}
