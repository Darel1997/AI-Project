import type { BlogPost } from "./index";
import * as B from "@/components/blog/prose";

export const introducingRepoInsight: BlogPost = {
  slug: "introducing-repoinsight",
  title: "Introducing RepoInsight: understand any codebase in minutes",
  description:
    "We built RepoInsight to fix the slowest part of software engineering — the first week on a new codebase. Here's what it does and why it exists.",
  author: { name: "The RepoInsight team" },
  publishedAt: "2026-04-18",
  tags: ["product", "launch", "ai"],
  readingTime: 4,
  featured: true,
  content: () => (
    <>
      <B.Lead>
        Every engineer has lived through the first-week-on-a-new-codebase tax. You clone the repo. You open a dozen files hoping to spot the entry point. You ping the one senior dev who knows how auth works. You read a README from two years ago that references a directory that doesn&apos;t exist anymore. By Friday, you&apos;ve written 12 lines of code.
      </B.Lead>
      <B.P>
        We built <B.Strong>RepoInsight</B.Strong> to collapse that week into 30 minutes.
      </B.P>

      <B.H2>The problem</B.H2>
      <B.P>
        Codebases are hard to understand because the code is the spec. Documentation lies. Diagrams rot. The only source of truth is the source itself — and reading source at the speed of an unfamiliar human is brutally slow.
      </B.P>
      <B.P>
        LLMs changed this. Claude can read thousands of files in seconds. The question was: how do you make that reading actually useful? Not just &quot;summarize this file&quot; useful — actually useful for the questions engineers ask every day:
      </B.P>
      <B.UL>
        <B.LI>Where does authentication live, and why is it structured that way?</B.LI>
        <B.LI>What tests exist, and what parts are uncovered?</B.LI>
        <B.LI>If I change this function, what breaks?</B.LI>
        <B.LI>How do I ship my first PR without reading every file?</B.LI>
      </B.UL>

      <B.H2>What RepoInsight does</B.H2>
      <B.P>
        Point RepoInsight at any GitHub repository — yours or someone else&apos;s — and it does four things:
      </B.P>
      <B.OL>
        <B.LI>
          <B.Strong>Indexes the code locally.</B.Strong> Every file gets chunked, embedded with sentence-transformers, and stored in a vector database. No code leaves your infrastructure for indexing.
        </B.LI>
        <B.LI>
          <B.Strong>Answers questions with citations.</B.Strong> Chat asks retrieve the most relevant snippets and feed them to Anthropic Claude, which returns an answer grounded in your actual source — every claim links back to a file and line range.
        </B.LI>
        <B.LI>
          <B.Strong>Generates reports.</B.Strong> Code quality audits. Security scans with CWE classifications. Onboarding guides for new devs. Architecture diagrams. Each report is cached so you only regenerate when the code changes.
        </B.LI>
        <B.LI>
          <B.Strong>Scales to teams.</B.Strong> Export Markdown reports for stakeholders. Share across your team. Track tasks generated from the analysis.
        </B.LI>
      </B.OL>

      <B.H2>Why we chose Anthropic Claude</B.H2>
      <B.P>
        Three reasons. First, Claude&apos;s context window is large enough to hold substantial slices of real codebases — we send up to a dozen files per query without truncation. Second, Claude follows instructions precisely about citation formatting, which is critical when users need to verify every claim against the source. Third, Claude is excellent at refusing to hallucinate. When the retrieval doesn&apos;t surface enough context, Claude says so instead of making up an answer — and that&apos;s the difference between a tool you trust and one you don&apos;t.
      </B.P>

      <B.H2>What&apos;s next</B.H2>
      <B.P>We&apos;re just getting started. On our roadmap:</B.P>
      <B.UL>
        <B.LI>GitHub App integration for push-triggered re-indexing — your docs update as your code updates</B.LI>
        <B.LI>Team workspaces with role-based access control</B.LI>
        <B.LI>Pull request reviewer — paste a PR URL, get an AI review with suggestions</B.LI>
        <B.LI>Knowledge graph — see how modules depend on each other across repos</B.LI>
      </B.UL>

      <B.Divider />

      <B.P>
        Try it free at <B.A href="/">repoinsight.ai</B.A>. Public repositories are unlimited and free forever. Tell us what to build next.
      </B.P>
    </>
  ),
};
