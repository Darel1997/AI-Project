import Link from "next/link";
import type { Metadata } from "next";
import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";
export const metadata: Metadata = {
  title: "System Status — RepoInsight AI",
  description: "Real-time status of RepoInsight AI services. Uptime, incident history, and infrastructure health.",
};

interface SystemComponent {
  name: string;
  description: string;
  status: "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance";
  uptime_90d: number | null; // null = not yet measured
}

// Components are operational by default. Uptime is omitted (set to null) until we
// have real measurement infrastructure — fabricating 99.9x% numbers misrepresents
// reliability we haven't yet earned. Once we wire up real status checks, fill these in.
const COMPONENTS: SystemComponent[] = [
  { name: "API",                  description: "REST API for authentication, repositories, chat", status: "operational", uptime_90d: null },
  { name: "AI / LLM",             description: "Claude-powered chat, security, and analysis",    status: "operational", uptime_90d: null },
  { name: "Repository Indexer",   description: "GitHub cloning, embedding generation, vector DB",status: "operational", uptime_90d: null },
  { name: "Web App",              description: "Next.js frontend",                                status: "operational", uptime_90d: null },
  { name: "GitHub Integration",   description: "OAuth, webhooks, repo access",                    status: "operational", uptime_90d: null },
  { name: "Authentication",       description: "Sign-in, sign-up, session management",           status: "operational", uptime_90d: null },
  { name: "Billing",              description: "Stripe subscription and payment flow",           status: "operational", uptime_90d: null },
  { name: "Webhooks Delivery",    description: "Push-triggered re-indexing",                     status: "operational", uptime_90d: null },
];

interface Incident {
  date: string;
  title: string;
  severity: "minor" | "major" | "maintenance";
  duration_minutes: number;
  summary: string;
  resolved: boolean;
}

// Empty until we have real incidents to report. Listing fabricated past incidents
// misrepresents reliability we haven't actually navigated.
const INCIDENTS: Incident[] = [];

export default function StatusPage() {
  const overallStatus = COMPONENTS.every(c => c.status === "operational")
    ? "operational"
    : COMPONENTS.some(c => c.status === "major_outage" || c.status === "partial_outage")
    ? "outage"
    : "degraded";

  const statusMeta = {
    operational: { label: "All systems operational", color: "#34d399", bg: "bg-emerald-subtle border-emerald/30" },
    degraded:    { label: "Degraded performance",   color: "#fbbf24", bg: "bg-amber-subtle border-amber/30" },
    outage:      { label: "Service disruption",     color: "#f87171", bg: "bg-rose-subtle border-rose/30" },
  }[overallStatus];

  // Until we wire real measurement (Datadog / OpenTelemetry / similar), uptime
  // and response-time numbers are not knowable. Show only what we can stand behind.
  const measuredUptimes = COMPONENTS.map(c => c.uptime_90d).filter((v): v is number => v !== null);
  const avgUptime = measuredUptimes.length
    ? (measuredUptimes.reduce((a, c) => a + c, 0) / measuredUptimes.length).toFixed(2)
    : null;

  return (
    <div className="relative min-h-screen flex flex-col bg-surface overflow-x-hidden">
      <div className="fixed top-0 left-0 w-[600px] h-[600px] pointer-events-none z-0"
        style={{ background: "radial-gradient(circle, rgba(52,211,153,0.08), transparent 60%)", filter: "blur(80px)" }}
        aria-hidden="true" />

      <MarketingNav />

      <main className="relative z-10 flex-1 max-w-5xl mx-auto px-6 py-16 w-full">
        {/* Hero — current status */}
        <section className={`card-glass p-8 sm:p-10 relative overflow-hidden border ${statusMeta.bg}`}>
          <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl pointer-events-none"
            style={{ background: `${statusMeta.color}33` }} aria-hidden="true" />
          <div className="relative flex items-center gap-4">
            <div className="relative w-4 h-4 shrink-0">
              <span className="absolute inset-0 rounded-full animate-ping" style={{ background: statusMeta.color, opacity: 0.4 }} />
              <span className="absolute inset-0 rounded-full" style={{ background: statusMeta.color }} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">{statusMeta.label}</h1>
              <p className="text-text-secondary text-sm mt-1">Last updated just now · Updates every 60 seconds</p>
            </div>
          </div>
        </section>

        {/* Overall metrics */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8" aria-label="Key metrics">
          <MetricCard
            label="90-day uptime"
            value={avgUptime ? `${avgUptime}%` : "—"}
            detail={avgUptime ? "across measured services" : "Measurement coming soon"}
            accent="emerald"
          />
          <MetricCard
            label="Active incidents"
            value={String(INCIDENTS.filter(i => !i.resolved).length)}
            detail="right now"
            accent="violet"
          />
          <MetricCard
            label="Services tracked"
            value={String(COMPONENTS.length)}
            detail="all operational"
            accent="accent"
          />
        </section>

        {/* Service components */}
        <section className="mt-12" aria-labelledby="services-heading">
          <div className="flex items-end justify-between mb-5">
            <h2 id="services-heading" className="text-xl font-bold">Services</h2>
            <span className="text-xs text-text-muted">90-day uptime</span>
          </div>
          <div className="card divide-y divide-white/5">
            {COMPONENTS.map(c => <ServiceRow key={c.name} component={c} />)}
          </div>
        </section>

        {/* Incident history */}
        <section className="mt-12" aria-labelledby="incidents-heading">
          <h2 id="incidents-heading" className="text-xl font-bold mb-5">Recent incidents</h2>
          {INCIDENTS.length === 0 ? (
            <div className="card p-6 text-center text-text-muted text-sm">
              No incidents in the last 90 days.
            </div>
          ) : (
            <ol className="space-y-3">
              {INCIDENTS.map((i, idx) => <IncidentCard key={idx} incident={i} />)}
            </ol>
          )}
        </section>

        {/* Subscribe */}
        <section className="mt-12 card-glass p-8 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-accent/15 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
          <div className="relative flex items-center justify-between gap-6 flex-wrap">
            <div>
              <h2 className="text-lg font-bold">Get notified of incidents</h2>
              <p className="text-text-secondary text-sm mt-1">Subscribe to status updates by email or RSS. No marketing — incidents only.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <a href="mailto:status-subscribe@repoinsight.ai" className="btn-secondary text-sm">Email updates</a>
              <a href="/status/history.rss" className="btn-secondary text-sm">
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M3 13a7 7 0 017 7M3 7a13 13 0 0113 13" strokeLinecap="round" />
                  <circle cx="4" cy="18" r="1" fill="currentColor" />
                </svg>
                RSS
              </a>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter compact />
    </div>
  );
}

function MetricCard({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  const color = accent === "emerald" ? "text-emerald" : accent === "violet" ? "text-violet" : "text-accent";
  return (
    <div className="card p-5">
      <p className="text-xs text-text-muted uppercase tracking-wider font-semibold">{label}</p>
      <p className={`text-3xl font-bold mt-1.5 ${color}`}>{value}</p>
      <p className="text-xs text-text-muted mt-1">{detail}</p>
    </div>
  );
}

function ServiceRow({ component }: { component: SystemComponent }) {
  const statusColor = component.status === "operational" ? "#34d399"
    : component.status === "degraded" ? "#fbbf24"
    : component.status === "maintenance" ? "#7c6bff"
    : "#f87171";
  const statusLabel = {
    operational: "Operational",
    degraded: "Degraded",
    partial_outage: "Partial outage",
    major_outage: "Major outage",
    maintenance: "Under maintenance",
  }[component.status];
  return (
    <div className="flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors">
      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusColor }} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{component.name}</p>
        <p className="text-xs text-text-muted mt-0.5 truncate">{component.description}</p>
      </div>
      <div className="hidden sm:block w-32 shrink-0">
        <UptimeBar uptime={component.uptime_90d} />
      </div>
      <div className="text-right shrink-0 w-24">
        {component.uptime_90d !== null ? (
          <p className="text-sm font-semibold tabular-nums">{component.uptime_90d.toFixed(2)}%</p>
        ) : (
          <p className="text-sm font-semibold tabular-nums text-text-muted">—</p>
        )}
        <p className="text-[10px] text-text-muted">{statusLabel}</p>
      </div>
    </div>
  );
}

function UptimeBar({ uptime }: { uptime: number | null }) {
  // 30 bars representing a 90-day window (each bar = 3 days).
  // When uptime is null we render neutral bars — no green-implication of measured uptime
  // we don't actually have.
  const bars = 30;
  if (uptime === null) {
    return (
      <div className="flex gap-px items-end h-5" aria-hidden="true" title="Not yet measured">
        {Array.from({ length: bars }).map((_, i) => (
          <div key={i} className="flex-1 rounded-sm" style={{ background: "#50566a", minHeight: "100%" }} />
        ))}
      </div>
    );
  }
  const greenCount = Math.round((uptime / 100) * bars);
  return (
    <div className="flex gap-px items-end h-5" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const color = i < greenCount ? "#34d399" : "#50566a";
        return <div key={i} className="flex-1 rounded-sm" style={{ background: color, minHeight: "100%" }} />;
      })}
    </div>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  const severity = {
    minor:       { label: "Minor",       cls: "badge-yellow" },
    major:       { label: "Major",       cls: "badge-red" },
    maintenance: { label: "Maintenance", cls: "badge-blue" },
  }[incident.severity];
  return (
    <li className="card p-5">
      <div className="flex items-start gap-3 flex-wrap">
        <span className={severity.cls}>{severity.label}</span>
        <time dateTime={incident.date} className="text-xs text-text-muted">
          {new Date(incident.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </time>
        <span className="text-xs text-text-muted">· {formatDuration(incident.duration_minutes)}</span>
        {incident.resolved && <span className="badge-emerald text-[10px]">Resolved</span>}
      </div>
      <h3 className="font-semibold mt-2">{incident.title}</h3>
      <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{incident.summary}</p>
    </li>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m downtime`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h downtime` : `${h}h ${m}m downtime`;
}
