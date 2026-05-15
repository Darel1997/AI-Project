"use client";

import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";
export default function EnterprisePage() {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", company: "", role: "",
    team_size: "50-200", use_case: "", timeline: "quarter",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || !form.company) {
      toast.error("Missing info", "Name, work email, and company are required.");
      return;
    }
    setSubmitting(true);
    // Production: POST to /api/contact or your CRM webhook. For now we craft a mailto.
    const subject = encodeURIComponent(`Enterprise inquiry from ${form.company}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\nCompany: ${form.company}\nRole: ${form.role}\n` +
      `Team size: ${form.team_size}\nTimeline: ${form.timeline}\n\nUse case:\n${form.use_case}`
    );
    // Open the user's email client with the pre-filled message — zero backend needed
    window.location.href = `mailto:sales@repoinsight.ai?subject=${subject}&body=${body}`;
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
      toast.success("Thanks!", "We'll be in touch within one business day.");
    }, 600);
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-surface overflow-x-hidden">
      <div className="fixed top-0 right-0 w-[700px] h-[700px] pointer-events-none z-0 animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.1), transparent 60%)", filter: "blur(90px)" }}
        aria-hidden="true" />
      <div className="fixed bottom-0 left-0 w-[600px] h-[600px] pointer-events-none z-0 animate-aurora"
        style={{ background: "radial-gradient(circle, rgba(183,148,244,0.1), transparent 60%)", filter: "blur(80px)", animationDelay: "4s" }}
        aria-hidden="true" />

      <MarketingNav />

      <main className="relative z-10 flex-1">
        {/* Hero */}
        <section className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
          <p className="eyebrow mb-6">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 3h14v14H3zM3 7h14M7 3v14" strokeLinejoin="round" />
            </svg>
            Enterprise
          </p>
          <h1 className="text-display-2 text-balance">
            RepoInsight for <span className="text-gradient">enterprise teams</span>
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto mt-5">
            Deploy RepoInsight across your entire engineering organization — with the security, compliance, and support that enterprise buyers require.
          </p>
        </section>

        {/* Customer-logo strip removed — fabricated social proof. We'll add real
            logos here once we have signed customers willing to be named publicly. */}

        {/* Pillars */}
        <section className="max-w-5xl mx-auto px-6 py-20" aria-labelledby="pillars-heading">
          <h2 id="pillars-heading" className="sr-only">Enterprise pillars</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Pillar
              title="Security-first"
              desc="Zero-retention AI inference, HMAC-verified webhook integrations, encrypted data at rest, and on-premise deployment available on request."
              icon={<svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M10 18s6-3 6-8V4l-6-2-6 2v6c0 5 6 8 6 8z" strokeLinejoin="round" /></svg>}
              color="emerald"
            />
            <Pillar
              title="Enterprise-ready from day one"
              desc="SSO (SAML / OIDC), SCIM provisioning, role-based access control, audit logs with CSV export, data retention policies."
              icon={<svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><rect x="3" y="9" width="14" height="9" rx="1.5" /><path d="M6 9V6a4 4 0 018 0v3" /></svg>}
              color="accent"
            />
            <Pillar
              title="Direct support"
              desc="Email and Slack support from the engineering team that builds RepoInsight. We respond fast because we're small and we care."
              icon={<svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M14 17v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" strokeLinejoin="round" /><circle cx="8" cy="6" r="3" /></svg>}
              color="violet"
            />
          </div>
        </section>

        {/* Compliance badges */}
        <section className="max-w-5xl mx-auto px-6 py-12">
          <div className="card-glass p-8 relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-48 h-48 bg-emerald/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
            <div className="relative">
              <h2 className="text-xl font-bold">Compliance &amp; certifications</h2>
              <p className="text-text-secondary text-sm mt-1">Compliance and audit roadmap below. We&apos;ll publish certifications and reports here as they&apos;re achieved.</p>
              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Badge title="SOC 2 Type II" status="Roadmap" done={false} />
                <Badge title="GDPR"          status="Roadmap" done={false} />
                <Badge title="CCPA"          status="Roadmap" done={false} />
                <Badge title="ISO 27001"     status="Roadmap" done={false} />
                <Badge title="HIPAA"         status="Roadmap" done={false} />
                <Badge title="PCI DSS"       status="Roadmap" done={false} />
                <Badge title="Pen test"      status="Roadmap" done={false} />
                <Badge title="Bug bounty"    status="Roadmap" done={false} />
              </div>
              <p className="mt-5 text-xs text-text-muted">
                Have questions about our security posture or need a security questionnaire?{" "}
                <a href="mailto:security@repoinsight.ai" className="text-accent hover:text-accent-hover">Email security@repoinsight.ai</a>
              </p>
            </div>
          </div>
        </section>

        {/* Contact form */}
        <section id="contact" className="max-w-4xl mx-auto px-6 py-16" aria-labelledby="contact-heading">
          <div className="text-center mb-10">
            <h2 id="contact-heading" className="text-display-3">Talk to sales</h2>
            <p className="text-text-secondary mt-3 max-w-xl mx-auto">
              Tell us about your team and how you&apos;d use RepoInsight. We&apos;ll get back within one business day with pricing and a custom demo.
            </p>
          </div>

          {submitted ? (
            <div className="card-glass p-10 text-center space-y-4 animate-fade-in">
              <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-emerald-subtle border border-emerald/30 mx-auto">
                <svg className="w-7 h-7 text-emerald" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="text-xl font-bold">Got it — check your email</h3>
              <p className="text-text-secondary max-w-md mx-auto">
                Your message is pre-filled in your email app. Send it to us and we&apos;ll respond within one business day.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-5" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Full name" required>
                  <input required type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Jane Doe" className="input w-full" />
                </Field>
                <Field label="Work email" required>
                  <input required type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="jane@company.com" className="input w-full" />
                </Field>
                <Field label="Company" required>
                  <input required type="text" value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} placeholder="Acme Inc." className="input w-full" />
                </Field>
                <Field label="Role">
                  <input type="text" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} placeholder="VP Engineering" className="input w-full" />
                </Field>
                <Field label="Team size">
                  <select value={form.team_size} onChange={e => setForm(p => ({ ...p, team_size: e.target.value }))} className="input w-full">
                    <option>1-10</option><option>10-50</option><option>50-200</option><option>200-1000</option><option>1000+</option>
                  </select>
                </Field>
                <Field label="Timeline">
                  <select value={form.timeline} onChange={e => setForm(p => ({ ...p, timeline: e.target.value }))} className="input w-full">
                    <option value="immediate">Immediate (within 30 days)</option>
                    <option value="quarter">This quarter</option>
                    <option value="half">This half</option>
                    <option value="exploring">Just exploring</option>
                  </select>
                </Field>
              </div>
              <Field label="How would your team use RepoInsight?">
                <textarea value={form.use_case} onChange={e => setForm(p => ({ ...p, use_case: e.target.value }))} rows={4} placeholder="e.g. Onboarding 50 engineers this quarter — need the Onboarding Simulator. Also interested in Blast Radius for our PR review process…" className="input w-full resize-none" />
              </Field>
              <div className="flex items-center gap-3 justify-end pt-2">
                <a href="mailto:sales@repoinsight.ai" className="btn-ghost text-sm">or email us directly</a>
                <button type="submit" disabled={submitting} className="btn-glow text-sm disabled:opacity-60">
                  {submitting ? "Opening email…" : "Send to sales"}
                </button>
              </div>
              <p className="text-[11px] text-text-muted text-center pt-1">
                This opens your email client with a pre-filled draft. We never store form data on submit.
              </p>
            </form>
          )}
        </section>
      </main>

      <MarketingFooter compact />
    </div>
  );
}

function LogoMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[15px] font-bold tracking-[0.2em] text-text-secondary hover:text-text-primary transition-colors">
      {children}
    </span>
  );
}

function Pillar({ title, desc, icon, color }: { title: string; desc: string; icon: React.ReactNode; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-subtle text-emerald",
    accent:  "bg-accent-subtle text-accent",
    violet:  "bg-violet-subtle text-violet",
  };
  return (
    <div className="card p-6 space-y-3">
      <div className={`inline-flex w-10 h-10 items-center justify-center rounded-lg ${colorMap[color]}`}>
        {icon}
      </div>
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
    </div>
  );
}

function Badge({ title, status, done }: { title: string; status: string; done: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${done ? "border-emerald/30 bg-emerald-subtle" : "border-white/10 bg-surface-overlay"}`}>
      <p className="font-semibold text-sm flex items-center gap-1.5">
        {done && (
          <svg className="w-3.5 h-3.5 text-emerald" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
            <path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {title}
      </p>
      <p className="text-[11px] text-text-muted mt-0.5">{status}</p>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted uppercase tracking-wider font-semibold block mb-1.5">
        {label} {required && <span className="text-accent">*</span>}
      </span>
      {children}
    </label>
  );
}
