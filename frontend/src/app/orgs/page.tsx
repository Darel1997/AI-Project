"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { orgs as orgsApi, OrgSummary } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

export default function OrgsPage() {
  const toast = useToast();
  const [orgList, setOrgList] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    orgsApi.list()
      .then(setOrgList)
      .catch(e => toast.error("Could not load organizations", e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const org = await orgsApi.create(newName.trim(), newDesc.trim() || undefined);
      setOrgList(p => [...p, org]);
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      toast.success("Organization created");
    } catch (e: any) {
      toast.error("Could not create", e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <header className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div>
          <p className="eyebrow mb-3">
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinejoin="round" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinejoin="round" />
            </svg>
            Teams
          </p>
          <h1 className="text-display-3">Organizations</h1>
          <p className="text-text-secondary text-sm mt-1.5">
            Workspaces you own or belong to. Invite teammates and share repositories.
          </p>
        </div>
        {!showCreate && (
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M10 5v10M5 10h10" strokeLinecap="round" />
            </svg>
            New organization
          </button>
        )}
      </header>

      {showCreate && (
        <form onSubmit={handleCreate} className="card p-5 space-y-4 animate-slide-up">
          <h2 className="font-semibold">Create an organization</h2>
          <div>
            <label htmlFor="org-name" className="text-xs text-text-muted uppercase tracking-wider block mb-1.5">Name</label>
            <input
              id="org-name"
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Acme Engineering"
              className="input w-full"
              autoFocus
              maxLength={100}
              required
            />
          </div>
          <div>
            <label htmlFor="org-desc" className="text-xs text-text-muted uppercase tracking-wider block mb-1.5">
              Description <span className="text-text-muted normal-case">(optional)</span>
            </label>
            <input
              id="org-desc"
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="What does your team work on?"
              className="input w-full"
              maxLength={200}
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newName.trim() || creating}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create organization"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-5 w-40" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : orgList.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <p className="text-text-muted text-sm">You&apos;re not in any organizations yet.</p>
          <p className="text-text-muted text-xs">Create one above to invite teammates.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orgList.map(org => (
            <OrgCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgCard({ org }: { org: OrgSummary }) {
  return (
    <Link href={`/orgs/${org.id}`} className="card-hover p-5 group relative overflow-hidden">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white font-bold shrink-0 shadow-glow-sm group-hover:shadow-glow transition-shadow">
          {org.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate group-hover:text-accent transition-colors">{org.name}</h3>
            {org.is_personal && <span className="badge-gray text-[10px]">Personal</span>}
            <RoleBadge role={org.my_role} />
          </div>
          {org.description && (
            <p className="text-sm text-text-secondary mt-1 line-clamp-2">{org.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-text-muted mt-3">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="7" cy="6" r="3" />
                <path d="M2 17v-1a4 4 0 014-4h2M13 13a3 3 0 100-6M18 17v-1a4 4 0 00-3-3.87" strokeLinecap="round" />
              </svg>
              {org.member_count} {org.member_count === 1 ? "member" : "members"}
            </span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{org.plan}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const map = {
    owner:  "badge-blue",
    admin:  "badge-green",
    member: "badge-gray",
  };
  return <span className={`${map[role]} text-[10px] capitalize`}>{role}</span>;
}
