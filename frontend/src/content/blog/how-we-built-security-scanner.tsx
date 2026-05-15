import type { BlogPost } from "./index";
import * as B from "@/components/blog/prose";

export const howWeBuiltSecurityScanner: BlogPost = {
  slug: "building-an-ai-security-scanner",
  title: "How we built an AI security scanner that's actually useful",
  description:
    "Static analysis tools catch easy stuff. AI catches the weird stuff. Here's how we combined both to build a security scanner that doesn't just paper the walls with noise.",
  author: { name: "The RepoInsight team" },
  publishedAt: "2026-04-04",
  tags: ["engineering", "security", "ai"],
  readingTime: 5,
  content: () => (
    <>
      <B.Lead>
        If you&apos;ve ever run Semgrep or Bandit on a real codebase, you know the pattern: hundreds of findings, 90% of them false positives, and the actual bugs buried in the noise. We wanted to build a scanner where the signal-to-noise ratio was flipped — few findings, most of them real.
      </B.Lead>

      <B.H2>The problem with rule-based scanners</B.H2>
      <B.P>
        Traditional SAST tools match patterns. They flag <B.Code>eval()</B.Code> calls, SQL string concatenation, hardcoded credentials. These rules catch the obvious stuff, which is good — you genuinely don&apos;t want <B.Code>eval(user_input)</B.Code> in production. But rule-based matching has two failure modes that ruin the experience at scale.
      </B.P>
      <B.P>
        First, <B.Strong>false positives</B.Strong>. A rule that flags every <B.Code>exec()</B.Code> call catches genuine RCEs but also every harmless test fixture, every database migration, every CLI argument parser. The signal drowns in the noise and developers eventually disable the tool.
      </B.P>
      <B.P>
        Second, <B.Strong>false negatives</B.Strong>. Rules miss bugs that require understanding intent. A function named <B.Code>sanitize_input()</B.Code> that does nothing isn&apos;t flagged — the rule sees a sanitizer, not the fact that it doesn&apos;t actually sanitize. A SQL query built by concatenating trusted and untrusted strings through three layers of helper functions isn&apos;t caught — the rule doesn&apos;t trace data flow across function boundaries.
      </B.P>

      <B.H2>What AI adds</B.H2>
      <B.P>
        LLMs are good at the stuff rule-based scanners are bad at. They read context. They spot inconsistencies between what code claims to do and what it actually does. They can reason about data flow across function boundaries in natural language.
      </B.P>
      <B.P>
        The obvious win is detection quality. The less obvious win is explanation quality. A rule-based scanner says &quot;unsafe deserialization in line 47.&quot; An AI scanner says:
      </B.P>
      <B.Quote>
        <B.P>
          The payload.loads() call deserializes pickled data from an HTTP request body without any integrity check. An attacker who can reach this endpoint can execute arbitrary code by crafting a malicious pickle payload. Replace pickle with JSON, or sign the payload with HMAC and verify before deserializing.
        </B.P>
      </B.Quote>
      <B.P>That second one is a ticket you can hand to a junior engineer. The first is homework.</B.P>

      <B.H2>Our architecture</B.H2>
      <B.P>RepoInsight&apos;s security scanner is a three-stage pipeline.</B.P>

      <B.H3>Stage 1: targeted retrieval</B.H3>
      <B.P>
        We don&apos;t send the whole repo to Claude. We use semantic retrieval to surface the files most likely to contain security-sensitive code: auth handlers, input parsers, database queries, crypto operations, anything that touches request bodies or file paths. Think of it as the security scanner&apos;s equivalent of a radiologist — you look at the right slices, not the whole body.
      </B.P>

      <B.H3>Stage 2: structured analysis</B.H3>
      <B.P>
        Claude analyzes the retrieved files against a checklist: hardcoded secrets, SQL injection, XSS, insecure deserialization, path traversal, CSRF, weak cryptography, logging of sensitive data, outdated dependencies with known CVEs. We use a strict JSON schema for the output, so every finding includes file path, severity, CWE identifier when applicable, a specific description, and a concrete remediation with code example.
      </B.P>
      <B.Pre lang="json">{`{
  "file_path": "src/auth/oauth.py",
  "line_hint": "exchange_code_for_token",
  "vulnerability": "Hardcoded OAuth secret",
  "severity": "critical",
  "cwe": "CWE-798",
  "description": "The OAuth client secret is embedded in source code and will be exposed in any repository clone.",
  "remediation": "Move the secret to an environment variable. Rotate the existing secret since it's already exposed in git history."
}`}</B.Pre>

      <B.H3>Stage 3: scoring + summary</B.H3>
      <B.P>
        After findings, Claude produces an overall security posture score (0-100) and a paragraph-level summary describing the codebase&apos;s overall security shape. This is what teams paste into security review tickets.
      </B.P>

      <B.H2>What it doesn&apos;t do</B.H2>
      <B.Callout kind="info" title="Not a replacement for human review">
        <B.P>
          RepoInsight&apos;s scanner catches a lot, but it&apos;s not a substitute for a dedicated security team, a bug bounty program, or formal penetration testing. We&apos;re explicit about this in the report output. The scanner&apos;s job is to catch the stuff that would be embarrassing to miss, not to certify production-readiness.
        </B.P>
      </B.Callout>

      <B.H2>What&apos;s next</B.H2>
      <B.P>Three directions we&apos;re exploring:</B.P>
      <B.UL>
        <B.LI>Dependency scanning — surfacing CVEs in direct and transitive dependencies with remediation paths</B.LI>
        <B.LI>Secret-specific scanning — integrating with tools like Gitleaks to catch secrets in git history, not just HEAD</B.LI>
        <B.LI>PR-time security review — block merges that introduce new critical findings</B.LI>
      </B.UL>

      <B.Divider />

      <B.P>
        Try the security scanner on your own repo — it&apos;s free for public repositories. <B.A href="/">Get started at repoinsight.ai</B.A>.
      </B.P>
    </>
  ),
};
