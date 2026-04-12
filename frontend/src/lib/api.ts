/**
 * API client — typed fetch wrapper for all backend endpoints.
 *
 * Automatically attaches the JWT from localStorage and handles
 * common error patterns (401 → redirect to login, etc).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/auth";
    }
    throw new Error("Unauthorized");
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }

  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────

export const auth = {
  register: (data: { email: string; password: string; full_name?: string }) =>
    request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  githubUrl: () => request<{ url: string }>("/api/auth/github/url"),

  githubCallback: (code: string) =>
    request<AuthResponse>("/api/auth/github/callback", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  me: () => request<User>("/api/auth/me"),
};

// ── Repos ─────────────────────────────────────────────────────────

export const repos = {
  list: () => request<RepoListResponse>("/api/repos/"),

  get: (id: number) => request<Repo>(`/api/repos/${id}`),

  import: (url: string) =>
    request<Repo>("/api/repos/import", {
      method: "POST",
      body: JSON.stringify({ github_repo_url: url }),
    }),

  reindex: (id: number) =>
    request<{ message: string }>(`/api/repos/${id}/reindex`, {
      method: "POST",
    }),

  delete: (id: number) =>
    request<void>(`/api/repos/${id}`, { method: "DELETE" }),
};

// ── Chat ──────────────────────────────────────────────────────────

export const chat = {
  send: (repoId: number, message: string) =>
    request<ChatResponse>("/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, message }),
    }),

  history: (repoId: number) =>
    request<ChatMessage[]>(`/api/chat/history/${repoId}`),
};

// ── AI ────────────────────────────────────────────────────────────

export const ai = {
  explainFile: (repoId: number, filePath: string) =>
    request<ExplainResponse>("/api/ai/explain", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId, file_path: filePath }),
    }),

  generateDocs: (repoId: number) =>
    request<DocsResponse>("/api/ai/docs", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId }),
    }),

  techDebt: (repoId: number) =>
    request<TechDebtResponse>("/api/ai/tech-debt", {
      method: "POST",
      body: JSON.stringify({ repository_id: repoId }),
    }),
};

// ── Tasks ─────────────────────────────────────────────────────────

export const tasks = {
  generate: (repoId: number, focusArea?: string, count?: number) =>
    request<TaskItem[]>("/api/tasks/generate", {
      method: "POST",
      body: JSON.stringify({
        repository_id: repoId,
        focus_area: focusArea,
        count: count || 5,
      }),
    }),

  list: (repoId: number) => request<TaskItem[]>(`/api/tasks/${repoId}`),
};

// ── Analytics ─────────────────────────────────────────────────────

export const analytics = {
  get: (repoId: number) =>
    request<AnalyticsData>(`/api/analytics/${repoId}`),
};

// ── Types ─────────────────────────────────────────────────────────

export interface User {
  id: number;
  email: string;
  full_name?: string;
  avatar_url?: string;
  github_username?: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Repo {
  id: number;
  full_name: string;
  name: string;
  description?: string;
  language?: string;
  stars: number;
  forks: number;
  is_indexed: boolean;
  index_status: string;
  total_files: number;
  indexed_files: number;
  health_score?: number;
  language_breakdown?: Record<string, number>;
  total_commits: number;
  total_contributors: number;
  total_lines: number;
  created_at: string;
}

export interface RepoListResponse {
  repos: Repo[];
  total: number;
}

export interface ChatSource {
  file_path: string;
  snippet: string;
  relevance: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  message_id: number;
}

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  sources?: ChatSource[];
  created_at: string;
}

export interface ExplainResponse {
  file_path: string;
  explanation: string;
  language?: string;
  line_count: number;
}

export interface DocsResponse {
  documentation: string;
  files_analyzed: number;
}

export interface TechDebtItem {
  file_path: string;
  issue: string;
  severity: string;
  category: string;
  suggestion: string;
}

export interface TechDebtResponse {
  items: TechDebtItem[];
  summary: string;
  overall_score: number;
}

export interface TaskItem {
  id: number;
  title: string;
  description: string;
  priority: string;
  difficulty: string;
  task_type: string;
  suggested_files?: string[];
  status: string;
  created_at: string;
}

export interface CommitActivity {
  date: string;
  count: number;
}

export interface ContributorStat {
  username: string;
  avatar_url?: string;
  commits: number;
  additions: number;
  deletions: number;
}

export interface AnalyticsData {
  health_score: number;
  total_commits: number;
  total_contributors: number;
  total_lines: number;
  language_breakdown: Record<string, number>;
  commit_activity: CommitActivity[];
  top_contributors: ContributorStat[];
}
