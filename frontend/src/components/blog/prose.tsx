import type { ReactNode } from "react";

/**
 * Typography primitives for blog posts. All are JSX components —
 * use them as <B.P>text</B.P>, never as function calls B.P("text").
 *
 * Usage inside a post:
 *   import * as B from "@/components/blog/prose";
 *   <B.Lead>The hook</B.Lead>
 *   <B.P>A paragraph with <B.Strong>emphasis</B.Strong></B.P>
 */

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-display-3 mt-12 mb-4 text-balance scroll-mt-20">{children}</h2>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="text-xl font-semibold mt-10 mb-3 text-balance scroll-mt-20">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-text-secondary leading-relaxed mb-4 text-pretty">{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-lg text-text-secondary leading-relaxed mb-6 text-pretty">{children}</p>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="text-text-primary font-semibold">{children}</strong>;
}

export function Em({ children }: { children: ReactNode }) {
  return <em className="italic">{children}</em>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="text-accent hover:text-accent-hover underline underline-offset-4 decoration-accent/30 hover:decoration-accent transition-colors"
    >
      {children}
    </a>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-surface-overlay border border-surface-border px-1.5 py-0.5 rounded-md text-[0.9em] font-mono text-accent">
      {children}
    </code>
  );
}

export function Pre({ lang, children }: { lang?: string; children: string }) {
  return (
    <div className="relative my-6 group">
      {lang && (
        <span className="absolute top-3 right-3 text-[10px] uppercase tracking-wider text-text-muted font-mono opacity-60">
          {lang}
        </span>
      )}
      <pre className="bg-surface-raised border border-surface-border rounded-lg p-4 overflow-x-auto">
        <code className="font-mono text-sm leading-relaxed text-text-primary whitespace-pre">{children}</code>
      </pre>
    </div>
  );
}

export function Quote({ children, cite }: { children: ReactNode; cite?: string }) {
  return (
    <blockquote className="my-6 pl-5 border-l-4 border-accent/50 italic text-text-secondary">
      {children}
      {cite && <footer className="mt-2 text-xs text-text-muted not-italic">— {cite}</footer>}
    </blockquote>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="space-y-2 mb-6 pl-1 list-none">{children}</ul>;
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className="space-y-2 mb-6 pl-5 list-decimal marker:text-text-muted">{children}</ol>;
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="text-text-secondary leading-relaxed flex items-start gap-2.5 text-pretty">
      <svg className="w-3.5 h-3.5 text-accent shrink-0 mt-1.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

export function Divider() {
  return <div className="divider my-10" aria-hidden="true" />;
}

export function Callout({ kind = "info", title, children }: {
  kind?: "info" | "warning" | "success" | "tip";
  title?: string;
  children: ReactNode;
}) {
  const colors: Record<string, string> = {
    info:    "border-accent/30 bg-accent-subtle",
    warning: "border-warning/30 bg-warning-muted",
    success: "border-success/30 bg-success-muted",
    tip:     "border-accent/30 bg-accent-subtle",
  };
  return (
    <aside className={`my-6 p-4 rounded-lg border ${colors[kind]}`}>
      {title && <p className="font-semibold text-sm text-text-primary mb-1.5">{title}</p>}
      <div className="text-sm text-text-secondary leading-relaxed [&>p]:mb-0">{children}</div>
    </aside>
  );
}

export function Image({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  return (
    <figure className="my-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="w-full rounded-lg border border-surface-border"
        loading="lazy"
      />
      {caption && <figcaption className="text-center text-xs text-text-muted mt-3">{caption}</figcaption>}
    </figure>
  );
}
