"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { orgs as orgsApi, InvitationInfo } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";

export default function InvitationAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const token = String(params.token || "");

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    orgsApi.getInvitation(token)
      .then(setInfo)
      .catch(e => setError(e.message || "This invitation is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    try {
      const org = await orgsApi.acceptInvitation(token);
      toast.success("Joined organization", `Welcome to ${org.name}`);
      router.push(`/orgs/${org.id}`);
    } catch (e: any) {
      toast.error("Could not accept", e.message);
      setAccepting(false);
    }
  }

  async function handleDecline() {
    try {
      await orgsApi.declineInvitation(token);
      router.push("/dashboard");
    } catch {
      router.push("/dashboard");
    }
  }

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-6">
        <div className="card p-8 max-w-md text-center space-y-5 animate-fade-in">
          <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-warning/10 border border-warning/30">
            <svg className="w-7 h-7 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4.99a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold">Invitation unavailable</h1>
            <p className="text-text-secondary text-sm mt-1.5">
              {error || "This invitation could not be found. It may have been revoked or already used."}
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Link href="/" className="btn-secondary text-sm">Home</Link>
            <Link href="/dashboard" className="btn-primary text-sm">Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  // Not signed in — prompt to sign up or log in
  if (!user) {
    const loginHref = `/auth?mode=login&next=${encodeURIComponent(`/invitations/${token}`)}`;
    const registerHref = `/auth?mode=register&next=${encodeURIComponent(`/invitations/${token}`)}&email=${encodeURIComponent(info.email)}`;
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-6 py-16">
        <div className="card p-8 max-w-md w-full text-center space-y-5 animate-fade-in">
          <div className="inline-flex w-14 h-14 items-center justify-center rounded-xl bg-accent-subtle">
            <svg className="w-7 h-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold">You&apos;re invited to join <span className="text-accent">{info.org_name}</span></h1>
            <p className="text-text-secondary text-sm mt-2">
              Invited as <span className="capitalize font-medium text-text-primary">{info.role}</span> via <span className="font-mono">{info.email}</span>
            </p>
          </div>
          <div className="pt-2 space-y-2">
            <Link href={registerHref} className="btn-primary w-full justify-center">
              Create an account
            </Link>
            <Link href={loginHref} className="btn-secondary w-full justify-center">
              Sign in to accept
            </Link>
          </div>
          <p className="text-xs text-text-muted">
            Make sure you sign in with {info.email}.
          </p>
        </div>
      </div>
    );
  }

  // Signed in but with a different email
  if (user.email.toLowerCase() !== info.email.toLowerCase()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-6">
        <div className="card p-8 max-w-md text-center space-y-5 animate-fade-in">
          <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-warning/10 border border-warning/30">
            <svg className="w-7 h-7 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4.99a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold">Wrong account</h1>
            <p className="text-text-secondary text-sm mt-2 text-pretty">
              This invitation was sent to <span className="font-mono text-text-primary">{info.email}</span>, but you&apos;re signed in as <span className="font-mono text-text-primary">{user.email}</span>.
            </p>
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            <Link href="/dashboard" className="btn-secondary text-sm">Go to dashboard</Link>
            <Link href="/settings" className="btn-primary text-sm">Sign out</Link>
          </div>
        </div>
      </div>
    );
  }

  // Signed in with correct email — show accept UI
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-6 py-16">
      <div className="card p-8 max-w-md w-full text-center space-y-5 animate-fade-in">
        <div className="inline-flex w-14 h-14 items-center justify-center rounded-xl bg-accent-subtle">
          <svg className="w-7 h-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <path d="M20 8v6M23 11h-6" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Join <span className="text-accent">{info.org_name}</span>?</h1>
          <p className="text-text-secondary text-sm mt-2">
            You&apos;ll join as <span className="capitalize font-medium text-text-primary">{info.role}</span> and get access to all shared repositories.
          </p>
        </div>
        <div className="flex gap-2 justify-center pt-2">
          <button onClick={handleDecline} className="btn-secondary text-sm">Decline</button>
          <button onClick={handleAccept} disabled={accepting} className="btn-primary text-sm disabled:opacity-50">
            {accepting ? "Joining…" : "Accept invitation"}
          </button>
        </div>
      </div>
    </div>
  );
}
