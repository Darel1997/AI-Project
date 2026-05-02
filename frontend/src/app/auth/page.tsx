"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { auth as authApi } from "@/lib/api";
import { BackendStatusBanner } from "@/components/ui/BackendStatusBanner";

function AuthContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { login, user, loading: authLoading } = useAuth();

  const initialMode = params.get("mode") === "register" ? "register" : "login";
  const [mode, setMode] = useState<"login" | "register">(initialMode);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // GitHub OAuth probe — null = unknown, true = configured, false = not.
  // We only show the GitHub button when we know it works, and we hide it
  // entirely (rather than showing a button that always fails) when it doesn't.
  const [githubConfigured, setGithubConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      const next = params.get("next");
      // Default to the dashboard — signed-in users want to land in the app
      router.replace(next || "/dashboard");
    }
  }, [user, authLoading, router, params]);

  useEffect(() => {
    const m = params.get("mode");
    if (m === "register") setMode("register");
    else if (m === "login") setMode("login");
  }, [params]);

  // Pre-check GitHub OAuth configuration once on mount. If the backend is
  // unreachable the BackendStatusBanner will show — meanwhile we keep the
  // probe at `null` (rather than `false`) so we can retry transparently
  // when the backend comes back. We don't surface this probe failing as an
  // error to the user; the banner handles that conversation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authApi.githubStatus();
        if (!cancelled) setGithubConfigured(r.configured);
      } catch {
        // Backend probably unreachable. The banner handles it; we just leave
        // the GitHub button hidden until we can confirm it works.
        if (!cancelled) setGithubConfigured(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function switchMode(newMode: "login" | "register") {
    setMode(newMode);
    setError("");
    setConfirmPassword("");
    // Preserve ?next= so invitation-accept flow still works after switching modes
    const next = params.get("next");
    const qs = new URLSearchParams({ mode: newMode });
    if (next) qs.set("next", next);
    router.replace(`/auth?${qs.toString()}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      if (!name.trim()) return setError("Please enter your name");
      if (!email.trim()) return setError("Please enter your email");
      if (password.length < 8) return setError("Password must be at least 8 characters");
      if (password !== confirmPassword) return setError("Passwords don't match");
      if (!agreedToTerms) return setError("Please agree to the terms to continue");
    }

    setLoading(true);
    try {
      const result = mode === "login"
        ? await authApi.login({ email: email.trim(), password })
        : await authApi.register({ email: email.trim(), password, full_name: name.trim() });

      login(result.access_token, result.user);
      // After sign-in, send to ?next= if provided (invitations, deep-links), else dashboard
      const next = params.get("next");
      router.push(next || "/dashboard");
    } catch (err: any) {
      const msg = err.message || "Something went wrong";
      if (msg.includes("already registered")) setError("An account with this email already exists. Try signing in instead.");
      else if (msg.toLowerCase().includes("invalid")) setError("Wrong email or password.");
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleGitHubLogin() {
    setError("");
    try {
      const { url } = await authApi.githubUrl();
      window.location.href = url;
    } catch (err: any) {
      const msg = err?.message || "";
      // Three distinct failure modes — surface each one with the right framing:
      //   1. Backend unreachable (network error from request())
      //   2. GitHub OAuth not configured on this deployment (501 from backend)
      //   3. Anything else
      if (/cannot reach the api server/i.test(msg)) {
        setError("Sign-in is paused while we can't reach the backend. The banner above has the details — try Retry, then click GitHub again.");
      } else if (msg.includes("not configured")) {
        setError("GitHub sign-in isn't set up on this deployment. You can still create an account with email below.");
      } else if (msg) {
        setError(msg);
      } else {
        setError("Could not start GitHub login. Please try again or use email sign-up below.");
      }
    }
  }

  const pwStrength = getPasswordStrength(password);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1fr,1.2fr] bg-surface relative overflow-hidden">
      {/* Ambient accent — shared across both panels */}
      <div className="fixed bottom-0 right-0 w-[600px] h-[600px] pointer-events-none z-0"
        style={{ background: "radial-gradient(circle, rgba(124,107,255,0.1), transparent 60%)", filter: "blur(80px)" }}
        aria-hidden="true" />

      {/* ── LEFT PANEL — Brand / social proof (hidden on mobile) ─── */}
      <aside className="hidden lg:flex relative overflow-hidden bg-surface-raised/60 backdrop-blur-xl border-r border-white/5 p-12 flex-col justify-between">
        <div className="absolute inset-0 bg-aurora opacity-70 pointer-events-none animate-aurora" aria-hidden="true" />
        <div className="absolute inset-0 bg-grid-pattern bg-[size:32px_32px] opacity-20 pointer-events-none" aria-hidden="true" />
        {/* Floating orbs */}
        <div className="absolute top-10 right-10 w-40 h-40 rounded-full pointer-events-none animate-float"
          style={{ background: "radial-gradient(circle, rgba(124,107,255,0.25), transparent 60%)", filter: "blur(40px)" }}
          aria-hidden="true" />
        <div className="absolute bottom-20 left-20 w-56 h-56 rounded-full pointer-events-none animate-float"
          style={{ background: "radial-gradient(circle, rgba(183,148,244,0.2), transparent 60%)", filter: "blur(40px)", animationDelay: "2s" }}
          aria-hidden="true" />

        <Link href="/" className="relative flex items-center gap-2.5 group w-fit z-10" aria-label="Back to RepoInsight AI home">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-sm shadow-glow-sm group-hover:shadow-glow transition-shadow">
            RI
          </div>
          <span className="text-lg font-semibold tracking-tight">RepoInsight <span className="text-text-muted font-normal">AI</span></span>
        </Link>

        <div className="relative space-y-8 max-w-md z-10">
          <blockquote className="space-y-4">
            <svg className="w-10 h-10 text-accent/60" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
              <path d="M9 10c-2.2 0-4 1.8-4 4v8h8v-8H9c0-1.7 1.3-3 3-3V7c-3.3 0-6 2.7-6 6-.2.4.9 1 .9 1H9zm13 0c-2.2 0-4 1.8-4 4v8h8v-8h-4c0-1.7 1.3-3 3-3V7c-3.3 0-6 2.7-6 6-.2.4.9 1 .9 1H22z" />
            </svg>
            <p className="text-xl lg:text-2xl font-medium text-text-primary leading-relaxed text-pretty">
              From &quot;never seen this codebase&quot; to shipping production fixes in a single afternoon.
            </p>
            <footer className="text-sm text-text-secondary">
              — The kind of workflow RepoInsight unlocks
            </footer>
          </blockquote>

          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-white/5">
            <Stat label="AI features" value="21" />
            <Stat label="Powered by" value="Claude" />
            <Stat label="Setup time" value="< 1 min" />
          </div>
        </div>

        <p className="relative text-xs text-text-muted z-10">
          © {new Date().getFullYear()} RepoInsight AI · Powered by Anthropic Claude
        </p>
      </aside>

      {/* ── RIGHT PANEL — Form ──────────────────────────────────── */}
      <main id="main-content" className="flex items-center justify-center p-6 sm:p-10 min-h-screen lg:min-h-0">
        <div className="w-full max-w-sm space-y-6 animate-fade-in">
          {/* Mobile logo + Back */}
          <div className="lg:hidden flex items-center justify-between mb-6">
            <Link href="/" className="flex items-center gap-2" aria-label="Home">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-xs">RI</div>
              <span className="font-semibold">RepoInsight AI</span>
            </Link>
            <Link href="/" className="text-text-muted hover:text-text-primary text-sm">← Back</Link>
          </div>

          {/* Header */}
          <header className="space-y-2">
            <h1 className="text-display-3 tracking-tight">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-text-secondary text-sm">
              {mode === "login"
                ? "Sign in to continue where you left off."
                : "Free forever for public repos. No credit card needed."}
            </p>
          </header>

          {/* Backend health banner — appears when the API is unreachable so
              users see the problem BEFORE they click GitHub or submit a form. */}
          <BackendStatusBanner />

          {/* GitHub OAuth — only rendered once we've confirmed the backend has
              it configured. While the probe is in-flight (githubConfigured === null)
              we render a placeholder so the layout doesn't jump. When it's
              explicitly disabled (false) the button is hidden entirely. */}
          {githubConfigured === null ? (
            <div className="h-[42px] rounded-lg bg-surface-overlay/40 animate-pulse" aria-hidden="true" />
          ) : githubConfigured ? (
            <button
              onClick={handleGitHubLogin}
              type="button"
              className="btn-secondary w-full py-2.5"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Continue with GitHub
            </button>
          ) : null}

          {/* Only show the divider when there's actually something above it */}
          {githubConfigured !== false && (
            <div className="flex items-center gap-4">
              <div className="flex-1 divider" />
              <span className="text-text-muted text-xs uppercase tracking-wider">or</span>
              <div className="flex-1 divider" />
            </div>
          )}

          {/* Email/password form */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === "register" && (
              <Field label="Name" htmlFor="name" required>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  placeholder="Ada Lovelace"
                  required
                  autoComplete="name"
                  autoFocus
                />
              </Field>
            )}

            <Field label="Email" htmlFor="email" required>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
                required
                autoComplete="email"
                autoFocus={mode === "login"}
              />
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              required
              action={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              }
            >
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
                required
                minLength={mode === "register" ? 8 : 1}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                aria-describedby={mode === "register" ? "pw-strength" : undefined}
              />
              {mode === "register" && password && <PasswordStrengthBar strength={pwStrength} />}
            </Field>

            {mode === "register" && (
              <>
                <Field label="Confirm password" htmlFor="confirm-password" required>
                  <input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`input ${confirmPassword && password !== confirmPassword ? "input-error" : ""}`}
                    placeholder="Type password again"
                    required
                    autoComplete="new-password"
                    aria-invalid={confirmPassword !== "" && password !== confirmPassword}
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-danger text-xs mt-1.5" role="alert">Passwords don&apos;t match</p>
                  )}
                </Field>

                <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-accent cursor-pointer"
                  />
                  <span className="text-text-secondary leading-snug group-hover:text-text-primary transition-colors">
                    I agree that RepoInsight will index my repositories and may send code snippets to Anthropic Claude to answer my questions.
                  </span>
                </label>
              </>
            )}

            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="text-sm bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5 text-danger flex items-start gap-2 animate-fade-in"
              >
                <svg className="w-4 h-4 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9v4h2V9H9zm0-4v2h2V5H9z" clipRule="evenodd" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-glow w-full py-2.5"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" aria-hidden="true" />
                  <span>{mode === "login" ? "Signing in…" : "Creating account…"}</span>
                </>
              ) : (
                mode === "login" ? "Sign in" : "Create free account"
              )}
            </button>
          </form>

          <p className="text-center text-text-secondary text-sm">
            {mode === "login" ? "New to RepoInsight?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
              className="text-accent hover:text-accent-hover font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  action,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={htmlFor} className="text-sm font-medium text-text-primary">
          {label} {required && <span className="text-danger" aria-hidden="true">*</span>}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}

function getPasswordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

function PasswordStrengthBar({ strength }: { strength: number }) {
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong"];
  const colors = ["bg-danger", "bg-danger", "bg-warning", "bg-accent", "bg-success"];
  const textColors = ["text-danger", "text-danger", "text-warning", "text-accent", "text-success"];
  return (
    <div id="pw-strength" className="mt-2 space-y-1" aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors duration-200 ${i < strength ? colors[strength] : "bg-surface-border"}`} />
        ))}
      </div>
      <p className={`text-[11px] ${textColors[strength]}`}>{labels[strength]}</p>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Loading" />
      </div>
    }>
      <AuthContent />
    </Suspense>
  );
}
