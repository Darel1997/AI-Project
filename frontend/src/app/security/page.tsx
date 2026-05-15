import Link from "next/link";
import type { Metadata } from "next";
import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";
export const metadata: Metadata = {
  title: "Security & Compliance — RepoInsight AI",
  description:
    "How RepoInsight protects your code: encryption, audit logs, and our security and compliance roadmap.",
};

export default function SecurityPage() {
  return (
    <div className="relative min-h-screen flex flex-col bg-surface overflow-x-hidden">
      <div className="fixed top-0 left-0 w-[600px] h-[600px] pointer-events-none z-0"
        style={{ background: "radial-gradient(circle, rgba(52,211,153,0.1), transparent 60%)", filter: "blur(80px)" }}
        aria-hidden="true" />

      <MarketingNav />

      <main id="main-content" className="relative z-10 flex-1">
        {/* Hero */}
        <section className="relative max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
          <p className="eyebrow mb-6">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M10 18s6-3 6-8V4l-6-2-6 2v6c0 5 6 8 6 8z" strokeLinejoin="round" />
            </svg>
            Security & Compliance
          </p>
          <h1 className="text-display-2 text-balance">
            Your code stays <span className="text-gradient-accent">your code</span>
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto mt-5 text-pretty">
            We take the security of your source code seriously. Here&apos;s exactly how we protect it, the compliance standards we meet, and the ones we&apos;re working toward.
          </p>
        </section>

        {/* Compliance badges */}
        <section className="max-w-5xl mx-auto px-6 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <ComplianceBadge label="SOC 2 Type II" status="Roadmap" icon={<ShieldIcon />} />
            <ComplianceBadge label="GDPR" status="Roadmap" icon={<GlobeIcon />} />
            <ComplianceBadge label="CCPA" status="Roadmap" icon={<LockIcon />} />
            <ComplianceBadge label="ISO 27001" status="Roadmap" icon={<CertIcon />} />
          </div>
        </section>

        {/* Core practices */}
        <section className="max-w-5xl mx-auto px-6 py-16" aria-labelledby="practices-heading">
          <div className="text-center mb-12">
            <h2 id="practices-heading" className="text-display-3">How we protect your data</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PRACTICES.map(p => (
              <PracticeCard key={p.title} {...p} />
            ))}
          </div>
        </section>

        {/* Data flow */}
        <section className="max-w-5xl mx-auto px-6 py-16" aria-labelledby="flow-heading">
          <div className="text-center mb-12">
            <h2 id="flow-heading" className="text-display-3">Your data&apos;s journey</h2>
            <p className="text-text-secondary mt-3 max-w-2xl mx-auto">
              Complete transparency into where your code goes and what we do with it.
            </p>
          </div>
          <div className="card-glass p-6 sm:p-10">
            <ol className="space-y-6">
              <FlowStep
                step={1}
                title="You connect a repository"
                desc="We request read-only access via GitHub OAuth. You can revoke access at any time from GitHub's settings."
              />
              <FlowStep
                step={2}
                title="Code is indexed on our infrastructure"
                desc="We use local sentence-transformers embeddings — your code is never sent to third-party embedding APIs. Vectors are stored in our encrypted ChromaDB instance."
              />
              <FlowStep
                step={3}
                title="Questions trigger AI queries"
                desc="When you ask a question, we send only the most relevant code snippets (not your whole repo) to Anthropic Claude. These snippets are processed under Anthropic's zero-retention policy — nothing is used for model training."
              />
              <FlowStep
                step={4}
                title="Delete anytime, all data purged"
                desc="When you delete a repo, all indexed content, embeddings, chat history, and cached reports are permanently removed within 30 days."
                last
              />
            </ol>
          </div>
        </section>

        {/* Disclosure / Contact */}
        <section className="max-w-3xl mx-auto px-6 py-16">
          <div className="card p-8 space-y-4">
            <h2 className="text-xl font-bold">Responsible disclosure</h2>
            <p className="text-text-secondary">
              Found a security issue? We&apos;d love to hear from you. Report vulnerabilities to{" "}
              <a href="mailto:security@repoinsight.ai" className="text-accent hover:text-accent-hover underline underline-offset-4">
                security@repoinsight.ai
              </a>
              . We respond within 24 hours and fix verified issues within 72 hours for critical severity.
            </p>
            <p className="text-text-secondary">
              We maintain a security.txt file at{" "}
              <a href="/.well-known/security.txt" className="text-accent hover:text-accent-hover underline underline-offset-4 font-mono text-sm">
                /.well-known/security.txt
              </a>
              {" "}per RFC 9116.
            </p>
            <div className="pt-2 text-xs text-text-muted">
              Last updated: January 2026 · Questions about enterprise compliance?{" "}
              <a href="mailto:hello@repoinsight.ai" className="text-accent hover:text-accent-hover">
                Contact sales
              </a>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter compact />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Icons
   ═══════════════════════════════════════════════════════════════ */

function ShieldIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M10 18s6-3 6-8V4l-6-2-6 2v6c0 5 6 8 6 8z" strokeLinejoin="round" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="M2 10h16M10 2a12 12 0 010 16M10 2a12 12 0 000 16" strokeLinecap="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="3" y="9" width="14" height="9" rx="2" />
      <path d="M6 9V6a4 4 0 018 0v3" />
    </svg>
  );
}
function CertIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M15 11v4a1 1 0 01-1.5.87L10 13.7l-3.5 2.17A1 1 0 015 15v-4" strokeLinejoin="round" />
      <circle cx="10" cy="8" r="5" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Components
   ═══════════════════════════════════════════════════════════════ */

function ComplianceBadge({ label, status, icon, done = false }: { label: string; status: string; icon: React.ReactNode; done?: boolean }) {
  return (
    <div className={`card p-5 text-center space-y-2 ${done ? "border-emerald/30" : ""}`}>
      <div className={`inline-flex w-10 h-10 items-center justify-center rounded-lg ${done ? "text-emerald bg-emerald-subtle" : "text-text-muted bg-surface-overlay"}`}>
        {icon}
      </div>
      <p className="font-semibold text-sm">{label}</p>
      <p className={`text-xs ${done ? "text-emerald" : "text-text-muted"}`}>{status}</p>
    </div>
  );
}

interface Practice { title: string; desc: string; icon: React.ReactNode; }

const PRACTICES: Practice[] = [
  {
    title: "Encryption at rest & in transit",
    desc: "All data is encrypted with AES-256 at rest in our database and vector store. All network traffic uses TLS 1.3.",
    icon: <LockIcon />,
  },
  {
    title: "Read-only repository access",
    desc: "We only request the minimum scopes needed to read your code. We never request write access, issue creation, or modification permissions.",
    icon: <ShieldIcon />,
  },
  {
    title: "Zero-retention AI inference",
    desc: "Queries to Anthropic Claude use zero data retention — your code is never logged, used for training, or kept after the response returns.",
    icon: <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M3 6h14M8 6V4a2 2 0 014 0v2M5 6l1 12a2 2 0 002 2h4a2 2 0 002-2l1-12" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
  {
    title: "HMAC-verified webhooks",
    desc: "GitHub webhooks are verified with HMAC-SHA256 signatures and idempotency keys — no forged events can trigger re-indexing.",
    icon: <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M10 2a6 6 0 016 6v2a6 6 0 11-12 0V8a6 6 0 016-6z" /><circle cx="10" cy="9" r="2" /></svg>,
  },
  {
    title: "Audit logs (Team plan)",
    desc: "Every auth event, member change, repo access, and admin action is logged with user, IP, timestamp, and user-agent. Exportable as CSV.",
    icon: <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M4 4h12v12H4z" /><path d="M7 8h6M7 11h6M7 14h3" strokeLinecap="round" /></svg>,
  },
  {
    title: "Role-based access control",
    desc: "Team workspaces support three roles (owner / admin / member) with granular permission boundaries. SSO via SAML and OIDC available on Team plans.",
    icon: <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M14 17v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" strokeLinejoin="round" /><circle cx="8" cy="6" r="3" /></svg>,
  },
];

function PracticeCard({ title, desc, icon }: Practice) {
  return (
    <div className="card p-5 space-y-3">
      <div className="inline-flex w-10 h-10 items-center justify-center rounded-lg bg-accent-subtle text-accent">
        {icon}
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function FlowStep({ step, title, desc, last = false }: { step: number; title: string; desc: string; last?: boolean }) {
  return (
    <li className="flex gap-4 relative">
      {!last && <div className="absolute left-4 top-10 bottom-0 w-px bg-gradient-to-b from-accent/30 to-transparent" aria-hidden="true" />}
      <div className="shrink-0 w-8 h-8 rounded-full bg-accent-subtle border border-accent/30 flex items-center justify-center text-accent text-sm font-bold">
        {step}
      </div>
      <div className="pb-2">
        <p className="font-semibold">{title}</p>
        <p className="text-text-secondary text-sm mt-1 leading-relaxed">{desc}</p>
      </div>
    </li>
  );
}
