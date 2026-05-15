"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { auth as authApi } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePreferences, type Theme, type FontSize, type Density, type Motion, type Contrast } from "@/hooks/usePreferences";

export default function SettingsPage() {
  const { user, logout, refresh } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { prefs, setPref, reset: resetPrefs } = usePreferences();

  // Profile
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // GitHub
  const [connecting, setConnecting] = useState(false);
  const githubConnected = !!user?.github_username;

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setFullName(user?.full_name || "");
  }, [user]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true); setProfileMsg(null);
    try {
      await authApi.updateProfile({ full_name: fullName.trim() });
      if (refresh) await refresh();
      setProfileMsg({ kind: "ok", text: "Profile updated" });
    } catch (err: any) {
      setProfileMsg({ kind: "err", text: err.message });
    } finally {
      setSavingProfile(false);
      setTimeout(() => setProfileMsg(null), 3000);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setPwMsg({ kind: "err", text: "New passwords don't match" });
      return;
    }
    if (newPw.length < 8) {
      setPwMsg({ kind: "err", text: "Password must be at least 8 characters" });
      return;
    }
    setSavingPw(true); setPwMsg(null);
    try {
      await authApi.changePassword({ current_password: currentPw, new_password: newPw });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setPwMsg({ kind: "ok", text: "Password updated successfully" });
    } catch (err: any) {
      setPwMsg({ kind: "err", text: err.message });
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwMsg(null), 4000);
    }
  }

  async function handleConnectGithub() {
    setConnecting(true);
    try {
      const { url } = await authApi.githubUrl();
      window.location.href = url;
    } catch { setConnecting(false); }
  }

  async function handleResetPrefs() {
    const ok = await confirm({
      title: "Reset all preferences?",
      description: "Returns appearance, accessibility, and notification settings to defaults. Your account, repos, and password are not affected.",
      confirmLabel: "Reset",
    });
    if (ok) {
      resetPrefs();
      toast.success("Preferences reset to defaults");
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== user?.email) return;
    setDeleting(true);
    try {
      await authApi.deleteAccount();
      localStorage.clear();
      router.push("/");
    } catch (err: any) {
      toast.error("Delete failed", err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8 animate-fade-in">
      <div>
        <p className="eyebrow mb-3">
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="10" cy="10" r="2.5" />
            <path d="M10 1v2M10 17v2M19 10h-2M3 10H1M16.24 3.76l-1.41 1.41M5.17 14.83l-1.41 1.41M16.24 16.24l-1.41-1.41M5.17 5.17l-1.41-1.41" strokeLinecap="round" />
          </svg>
          Settings
        </p>
        <h1 className="text-display-3">Account & preferences</h1>
        <p className="text-text-secondary mt-1.5">Manage your profile, accessibility, and notifications.</p>
      </div>

      {/* ── Profile ─────────────────────────────────────────── */}
      <section className="card p-6 space-y-5 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-accent/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative">
          <h2 className="font-semibold text-lg">Profile</h2>
          <p className="text-text-muted text-sm mt-0.5">Your public identity in RepoInsight.</p>
        </div>
        <div className="relative flex items-center gap-4">
          {user?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar_url} alt="" className="w-16 h-16 rounded-full ring-2 ring-accent/30 shadow-glow-sm" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white text-xl font-bold ring-2 ring-white/10 shadow-glow-sm">
              {(user?.full_name || user?.email || "U")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <p className="font-medium">{user?.full_name || "Set a display name"}</p>
            <p className="text-text-secondary text-sm">{user?.email}</p>
            {user?.github_username && (
              <p className="text-text-muted text-xs mt-1 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.8 8.21 11.38.6.11.82-.25.82-.57v-2C4 22 3.5 19.5 3.5 19.5 3 18.5 2 18 2 18c-1-.73.08-.72.08-.72 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.3.76-1.6C5.62 17.6 2.66 16.6 2.66 12c0-1.3.47-2.39 1.24-3.23C3.78 8.47 3.36 7.24 4 5.6c0 0 1.01-.32 3.3 1.23A11.54 11.54 0 0112 6.34a11.54 11.54 0 014.7.49c2.29-1.55 3.29-1.23 3.29-1.23.65 1.64.24 2.87.12 3.17.77.84 1.23 1.93 1.23 3.23 0 4.62-2.97 5.6-5.78 5.9.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
                @{user.github_username}
              </p>
            )}
          </div>
        </div>
        <form onSubmit={saveProfile} className="space-y-3 relative">
          <div>
            <label htmlFor="display-name" className="text-xs text-text-muted uppercase tracking-wider font-semibold">Display name</label>
            <input id="display-name" type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="Your name" className="input w-full mt-1.5" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingProfile} className="btn-primary text-sm disabled:opacity-50">
              {savingProfile ? "Saving…" : "Save changes"}
            </button>
            {profileMsg && (
              <span className={`text-xs ${profileMsg.kind === "ok" ? "text-emerald" : "text-danger"} animate-fade-in`} role="status">
                {profileMsg.text}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* ── Password ─────────────────────────────────────────── */}
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold">Password</h2>
        {user?.github_username && !currentPw ? (
          <p className="text-text-muted text-sm">
            You signed up with GitHub. To set a password, enter a new one below and confirm.
            <br/>
            <span className="text-xs">Note: your account will still support GitHub login as well.</span>
          </p>
        ) : null}
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label htmlFor="current-pw" className="text-xs text-text-muted uppercase tracking-wider">Current Password</label>
            <input id="current-pw" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              placeholder="••••••••" className="input w-full mt-1" required autoComplete="current-password" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-pw" className="text-xs text-text-muted uppercase tracking-wider">New Password</label>
              <input id="new-pw" type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="At least 8 characters" className="input w-full mt-1" required minLength={8} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="confirm-pw" className="text-xs text-text-muted uppercase tracking-wider">Confirm New Password</label>
              <input id="confirm-pw" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Type again" className="input w-full mt-1" required autoComplete="new-password" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingPw || !currentPw || !newPw} className="btn-primary text-sm disabled:opacity-50">
              {savingPw ? "Updating..." : "Update Password"}
            </button>
            {pwMsg && (
              <span className={`text-xs ${pwMsg.kind === "ok" ? "text-success" : "text-danger"}`} role="status">
                {pwMsg.text}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* ── Connected Services ───────────────────────────────── */}
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Connected Services</h2>
          <p className="text-text-muted text-xs mt-1">Connect GitHub to access private repositories.</p>
        </div>
        <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-surface-border">
          <div className="flex items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-text-primary" aria-hidden="true">
              <path d="M12 0a12 12 0 00-3.79 23.4c.6.11.82-.26.82-.58V21c-3.34.73-4.04-1.4-4.04-1.4-.55-1.4-1.34-1.77-1.34-1.77-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.66-.3-5.46-1.33-5.46-5.93 0-1.3.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.65.24 2.87.12 3.17.77.84 1.24 1.92 1.24 3.22 0 4.61-2.8 5.62-5.48 5.92.42.37.8 1.1.8 2.22v3.3c0 .32.22.7.82.58A12 12 0 0012 0z" />
            </svg>
            <div>
              <p className="font-medium text-sm">GitHub</p>
              <p className="text-xs text-text-muted">
                {githubConnected ? `Connected as @${user?.github_username}` : "Not connected — needed for private repos"}
              </p>
            </div>
          </div>
          {githubConnected ? (
            <span className="badge-green">Connected</span>
          ) : (
            <button onClick={handleConnectGithub} disabled={connecting} className="btn-primary text-sm disabled:opacity-50">
              {connecting ? "Connecting..." : "Connect"}
            </button>
          )}
        </div>
      </section>

      {/* ── Appearance ───────────────────────────────────────── */}
      <section className="card p-6 space-y-5">
        <div>
          <h2 className="font-semibold">Appearance</h2>
          <p className="text-text-muted text-sm mt-0.5">How RepoInsight looks on this device.</p>
        </div>

        {/* Theme */}
        <SettingRow label="Theme" hint="Light works well in bright environments. System follows your OS setting.">
          <SegmentedControl<Theme>
            value={prefs.theme}
            onChange={(v) => setPref("theme", v)}
            options={[
              { value: "system", label: "System", icon: <SunMoonIcon /> },
              { value: "dark",   label: "Dark",   icon: <MoonIcon /> },
              { value: "light",  label: "Light",  icon: <SunIcon /> },
            ]}
          />
        </SettingRow>

        {/* Density */}
        <SettingRow label="Density" hint="Compact fits more on screen. Comfortable adds breathing room.">
          <SegmentedControl<Density>
            value={prefs.density}
            onChange={(v) => setPref("density", v)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact",     label: "Compact" },
            ]}
          />
        </SettingRow>
      </section>

      {/* ── Accessibility ────────────────────────────────────── */}
      <section className="card p-6 space-y-5">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="8" r="1.5" fill="currentColor" />
              <path d="M9.5 12h5l-1 6M12 12v3" />
            </svg>
            Accessibility
          </h2>
          <p className="text-text-muted text-sm mt-0.5">
            Make the interface easier to read and interact with.{" "}
            <a href="https://www.w3.org/WAI/standards-guidelines/wcag/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              WCAG 2.2 reference
            </a>
          </p>
        </div>

        {/* Font size */}
        <SettingRow label="Text size" hint="Increases all text proportionally — including buttons, menus, and code.">
          <SegmentedControl<FontSize>
            value={prefs.fontSize}
            onChange={(v) => setPref("fontSize", v)}
            options={[
              { value: "default",     label: "Default",  hintText: "16 px" },
              { value: "large",       label: "Large",    hintText: "18 px" },
              { value: "extra-large", label: "Extra",    hintText: "20 px" },
            ]}
          />
        </SettingRow>

        {/* Reduced motion */}
        <SettingRow label="Motion" hint="Reducing motion disables non-essential animations — helps with vestibular disorders and motion sensitivity.">
          <SegmentedControl<Motion>
            value={prefs.motion}
            onChange={(v) => setPref("motion", v)}
            options={[
              { value: "system",  label: "System" },
              { value: "full",    label: "Full" },
              { value: "reduced", label: "Reduced" },
            ]}
          />
        </SettingRow>

        {/* High contrast */}
        <SettingRow label="Contrast" hint="High contrast strengthens text and borders for low-vision users.">
          <SegmentedControl<Contrast>
            value={prefs.contrast}
            onChange={(v) => setPref("contrast", v)}
            options={[
              { value: "default", label: "Default" },
              { value: "high",    label: "High" },
            ]}
          />
        </SettingRow>

        <div className="pt-2 border-t border-white/5 flex items-center justify-end">
          <button onClick={handleResetPrefs} className="btn-secondary text-xs">
            Reset to defaults
          </button>
        </div>
      </section>

      {/* ── Notifications ────────────────────────────────────── */}
      <section className="card p-6 space-y-5">
        <div>
          <h2 className="font-semibold">Notifications</h2>
          <p className="text-text-muted text-sm mt-0.5">Email preferences. We never email about anything outside RepoInsight.</p>
        </div>
        <ToggleRow
          checked={prefs.emailOnScanComplete}
          onChange={(v) => setPref("emailOnScanComplete", v)}
          label="Long-running scan finished"
          description="When a security audit, architecture diagram, or onboarding guide completes — useful if you closed the tab."
        />
        <ToggleRow
          checked={prefs.emailWeeklyDigest}
          onChange={(v) => setPref("emailWeeklyDigest", v)}
          label="Weekly digest"
          description="A Monday-morning summary of new findings, dependency alerts, and code-quality changes across your repos."
        />
      </section>

      {/* ── Sessions & Sign-out ──────────────────────────────── */}
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Sessions</h2>
          <p className="text-text-muted text-sm mt-0.5">Sign out of this browser.</p>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-xs text-text-muted">
            Signed in as <span className="text-text-primary font-medium">{user?.email}</span>
          </div>
          <button onClick={logout} className="btn-secondary text-sm">Sign out</button>
        </div>
      </section>

      {/* ── Keyboard shortcuts ───────────────────────────────── */}
      <section className="card p-6 space-y-3">
        <h2 className="font-semibold">Keyboard shortcuts</h2>
        <p className="text-text-muted text-sm">All these work anywhere in the app.</p>
        <div className="space-y-1.5 text-sm pt-2">
          <ShortcutRow keys={["⌘", "K"]}        winKeys={["Ctrl", "K"]} desc="Open command palette" />
          <ShortcutRow keys={["⌘", "Enter"]}    winKeys={["Ctrl", "Enter"]} desc="Send chat message" />
          <ShortcutRow keys={["⌘", "/"]}        winKeys={["Ctrl", "/"]} desc="Focus search" />
          <ShortcutRow keys={["Esc"]}                                  desc="Close dialogs and panels" />
          <ShortcutRow keys={["Tab"]}                                  desc="Move between fields" />
          <ShortcutRow keys={["Shift", "Tab"]}                         desc="Move backward between fields" />
        </div>
      </section>

      {/* ── Danger Zone ──────────────────────────────────────── */}
      <section className="card p-6 space-y-4 border-danger/30 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-danger/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="relative">
          <h2 className="font-semibold text-danger flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M10 2v2M10 16v2M4 10H2M18 10h-2M5.6 5.6L4 4M16 16l-1.6-1.6M5.6 14.4L4 16M16 4l-1.6 1.6" strokeLinecap="round" />
              <circle cx="10" cy="10" r="4" />
            </svg>
            Danger zone
          </h2>
        </div>
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="text-xs text-text-muted mt-0.5 max-w-md">Permanently delete your account and all repositories, tasks, chat history, and reports. This cannot be undone.</p>
          </div>
          <button onClick={() => setShowDeleteConfirm(true)} className="btn-danger text-sm shrink-0">
            Delete account
          </button>
        </div>
      </section>

      {/* ── About ────────────────────────────────────────────── */}
      <section className="card p-6 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <svg className="w-4 h-4 text-accent" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            <path d="M10 6v4M10 14h.01" strokeLinecap="round" />
          </svg>
          About RepoInsight
        </h2>
        <div className="text-sm space-y-2 text-text-secondary">
          <p>AI-powered codebase analysis — chat with your code, generate docs, detect security issues, and create engineering tasks.</p>
        </div>
      </section>

      {/* ── Delete account modal ─────────────────────────────── */}
      {showDeleteConfirm && (
        /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteConfirm(false); setDeleteConfirmText(""); } }}
          onKeyDown={(e) => { if (e.key === "Escape") { setShowDeleteConfirm(false); setDeleteConfirmText(""); } }}
          tabIndex={-1}
        >
          <div className="card shadow-card-hover p-6 max-w-md w-full space-y-4 border-danger/40 animate-scale-in">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4.99a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 id="delete-account-title" className="text-lg font-semibold text-text-primary">Delete account?</h3>
                <p className="text-text-secondary text-sm leading-relaxed mt-1">
                  This <span className="text-danger font-semibold">permanently deletes</span> your account, all imported repositories, tasks, chat history, and cached reports. Your actual GitHub code is NOT affected.
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="delete-confirm-input" className="text-xs text-text-muted uppercase tracking-wider block mb-1.5">
                Type your email to confirm: <span className="font-mono text-text-primary normal-case">{user?.email}</span>
              </label>
              <input
                id="delete-confirm-input"
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                className="input w-full"
                placeholder={user?.email}
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirmText !== user?.email}
                className="btn-danger text-sm disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Reusable widgets — kept in the same file to make the settings page
   self-contained. None of these are used elsewhere in the app.
   ───────────────────────────────────────────────────────────────── */

/** Label + hint stacked on the left, control flush right.
 *  Wraps to a stacked layout on narrow screens. */
function SettingRow({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3 border-b border-white/5 last:border-b-0 last:pb-0">
      <div className="sm:max-w-xs">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-text-muted mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A pill-style on/off switch with associated description text. */
function ToggleRow({
  checked, onChange, label, description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-text-muted mt-0.5 leading-snug">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-6 rounded-full transition-colors duration-200
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          ${checked ? "bg-accent" : "bg-surface-overlay border border-white/10"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200
            ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </div>
  );
}

interface SegOption<T> {
  value: T;
  label: string;
  /** Optional secondary line under the label inside the pill. */
  hintText?: string;
  /** Optional leading icon. */
  icon?: React.ReactNode;
}

/** Segmented control — radio-button-like row of pills.
 *  Picks the active option, fires onChange. Generic over the option's value type. */
function SegmentedControl<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
}) {
  return (
    <div role="radiogroup" className="inline-flex items-stretch p-1 rounded-lg bg-surface-overlay/60 border border-white/5">
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`relative inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
              transition-colors duration-150
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
              ${active
                ? "bg-accent/15 text-accent shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-white/5"}`}
          >
            {opt.icon && <span aria-hidden="true">{opt.icon}</span>}
            <span className="flex flex-col items-center leading-tight">
              <span>{opt.label}</span>
              {opt.hintText && <span className="text-[10px] opacity-70">{opt.hintText}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ShortcutRow({
  keys, winKeys, desc,
}: { keys: string[]; winKeys?: string[]; desc: string }) {
  // Show the platform-appropriate keybinding. The mac shortcut sits first;
  // we render Windows/Linux keys in parens after if they differ.
  return (
    <div className="flex items-center justify-between py-1 gap-3">
      <span className="text-text-secondary">{desc}</span>
      <div className="flex items-center gap-2">
        <KeyCombo keys={keys} />
        {winKeys && (
          <span className="text-text-muted text-[11px] hidden sm:inline">
            (<KeyCombo keys={winKeys} /> on Windows)
          </span>
        )}
      </div>
    </div>
  );
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center">
          <kbd className="bg-surface-overlay border border-white/10 px-1.5 py-0.5 rounded text-[11px] font-mono">{k}</kbd>
          {i < keys.length - 1 && <span className="text-text-muted mx-0.5">+</span>}
        </span>
      ))}
    </span>
  );
}

/* ── Inline icons ──────────────────────────────────────────── */

function SunIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 9.5A6 6 0 016.5 2a6 6 0 107.5 7.5z" />
    </svg>
  );
}
function SunMoonIcon() {
  // Half-sun, half-moon — represents "system follows OS"
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 4.8v6.4" />
      <path d="M8 5a3 3 0 000 6" fill="currentColor" />
    </svg>
  );
}
