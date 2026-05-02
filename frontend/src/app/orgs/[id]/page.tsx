"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { orgs as orgsApi, OrgDetail, OrgMember, PendingInvitation } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type Role = "owner" | "admin" | "member";
const ROLE_RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export default function OrgDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const orgId = Number(params.id);

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([orgsApi.get(orgId), orgsApi.listInvitations(orgId).catch(() => [])])
      .then(([o, invs]) => {
        setOrg(o);
        setInvitations(invs);
      })
      .catch(e => toast.error("Could not load organization", e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const canManage = org && ROLE_RANK[org.my_role] >= ROLE_RANK.admin;

  async function handleInvite(email: string, role: Role) {
    try {
      const inv = await orgsApi.invite(orgId, email, role);
      setInvitations(p => {
        const existing = p.findIndex(i => i.email === inv.email);
        if (existing >= 0) {
          const next = [...p];
          next[existing] = inv;
          return next;
        }
        return [inv, ...p];
      });
      toast.success("Invitation sent", `${email} was invited as ${role}`);
    } catch (e: any) {
      toast.error("Could not invite", e.message);
    }
  }

  async function handleRevokeInvite(invId: number, email: string) {
    const ok = await confirm({
      title: "Revoke invitation?",
      description: `${email} will no longer be able to use their invite link.`,
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    try {
      await orgsApi.revokeInvitation(orgId, invId);
      setInvitations(p => p.filter(i => i.id !== invId));
      toast.success("Invitation revoked");
    } catch (e: any) {
      toast.error("Could not revoke", e.message);
    }
  }

  async function handleChangeRole(userId: number, newRole: Role) {
    try {
      const updated = await orgsApi.changeRole(orgId, userId, newRole);
      setOrg(o => o ? { ...o, members: o.members.map(m => m.user_id === userId ? updated : m) } : o);
      toast.success(`Role updated to ${newRole}`);
    } catch (e: any) {
      toast.error("Could not change role", e.message);
    }
  }

  async function handleRemoveMember(member: OrgMember) {
    const ok = await confirm({
      title: `Remove ${member.full_name || member.email}?`,
      description: "They will lose access to all repositories and data in this organization.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await orgsApi.removeMember(orgId, member.user_id);
      setOrg(o => o ? { ...o, members: o.members.filter(m => m.user_id !== member.user_id) } : o);
      toast.success("Member removed");
    } catch (e: any) {
      toast.error("Could not remove member", e.message);
    }
  }

  async function handleDeleteOrg() {
    if (!org) return;
    const ok = await confirm({
      title: "Delete organization?",
      description: `This permanently deletes ${org.name} and removes all its members. Repositories linked to this org will become personal.`,
      confirmLabel: "Delete organization",
      destructive: true,
    });
    if (!ok) return;
    try {
      await orgsApi.delete(orgId);
      toast.success("Organization deleted");
      router.push("/orgs");
    } catch (e: any) {
      toast.error("Could not delete", e.message);
    }
  }

  if (loading) return <OrgDetailSkeleton />;
  if (!org) return null;

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <Link href="/orgs" className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm transition-colors">
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M13 16l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        All organizations
      </Link>

      <header className="flex items-start justify-between gap-4 flex-col sm:flex-row">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold text-lg shadow-glow-sm shrink-0">
            {org.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-display-3">{org.name}</h1>
              {org.is_personal && <span className="badge-gray">Personal</span>}
              <span className="badge-blue capitalize">{org.my_role}</span>
            </div>
            {org.description && (
              <p className="text-text-secondary mt-1 text-sm">{org.description}</p>
            )}
            <p className="text-text-muted text-xs mt-1 font-mono">@{org.slug}</p>
          </div>
        </div>
      </header>

      {/* Members section */}
      <section className="card p-6 space-y-4" aria-labelledby="members-heading">
        <div className="flex items-center justify-between">
          <h2 id="members-heading" className="font-semibold">Members ({org.members.length})</h2>
        </div>
        <ul className="divide-y divide-surface-border">
          {org.members.map(m => (
            <li key={m.user_id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
              {m.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatar_url} alt="" className="w-9 h-9 rounded-full ring-1 ring-surface-border" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold ring-1 ring-accent/20">
                  {(m.full_name || m.email)[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.full_name || m.email}</p>
                <p className="text-xs text-text-muted truncate">{m.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canManage && m.role !== "owner" ? (
                  <select
                    value={m.role}
                    onChange={e => handleChangeRole(m.user_id, e.target.value as Role)}
                    className="input text-xs py-1 pl-2 pr-7 capitalize"
                    aria-label={`Change role for ${m.full_name || m.email}`}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    {org.my_role === "owner" && <option value="owner">Owner</option>}
                  </select>
                ) : (
                  <span className="text-xs text-text-muted capitalize px-2">{m.role}</span>
                )}
                {canManage && m.role !== "owner" && (
                  <button
                    onClick={() => handleRemoveMember(m)}
                    className="btn-ghost text-xs px-2 py-1 text-danger hover:bg-danger/5"
                    aria-label={`Remove ${m.full_name || m.email}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Invite section */}
      {canManage && !org.is_personal && (
        <InviteForm onInvite={handleInvite} />
      )}

      {/* Pending invitations */}
      {canManage && invitations.length > 0 && (
        <section className="card p-6 space-y-4" aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="font-semibold">Pending invitations ({invitations.length})</h2>
          <ul className="divide-y divide-surface-border">
            {invitations.map(inv => (
              <li key={inv.id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-surface-overlay flex items-center justify-center text-text-muted shrink-0">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="2" y="4" width="16" height="12" rx="1.5" />
                    <path d="M2 6l8 5 8-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inv.email}</p>
                  <p className="text-xs text-text-muted">
                    Invited as <span className="capitalize">{inv.role}</span> · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeInvite(inv.id, inv.email)}
                  className="btn-ghost text-xs px-2 py-1 text-danger hover:bg-danger/5"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Danger zone */}
      {org.my_role === "owner" && !org.is_personal && (
        <section className="card p-6 border-danger/30 space-y-3" aria-labelledby="danger-heading">
          <h2 id="danger-heading" className="font-semibold text-danger">Danger zone</h2>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium text-sm">Delete this organization</p>
              <p className="text-sm text-text-secondary mt-1">Permanently removes this workspace. Cannot be undone.</p>
            </div>
            <button onClick={handleDeleteOrg} className="btn-danger text-sm shrink-0">
              Delete organization
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function InviteForm({ onInvite }: { onInvite: (email: string, role: Role) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onInvite(email.trim(), role);
      setEmail("");
      setRole("member");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card p-6 space-y-4" aria-labelledby="invite-heading">
      <div>
        <h2 id="invite-heading" className="font-semibold">Invite a teammate</h2>
        <p className="text-sm text-text-secondary mt-1">
          They'll receive an invitation link valid for 7 days.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 flex-wrap sm:flex-nowrap">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="teammate@example.com"
          className="input flex-1 min-w-[200px]"
          required
        />
        <select
          value={role}
          onChange={e => setRole(e.target.value as Role)}
          className="input w-auto"
          aria-label="Role"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          disabled={!email.trim() || submitting}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Invite"}
        </button>
      </form>
    </section>
  );
}

function OrgDetailSkeleton() {
  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start gap-4">
        <div className="skeleton w-14 h-14 rounded-xl" />
        <div className="space-y-2 flex-1">
          <div className="skeleton h-7 w-48" />
          <div className="skeleton h-4 w-64" />
        </div>
      </div>
      <div className="card p-6 space-y-3">
        <div className="skeleton h-5 w-32" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="skeleton w-9 h-9 rounded-full" />
            <div className="space-y-1.5 flex-1">
              <div className="skeleton h-4 w-36" />
              <div className="skeleton h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
