import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog — What's new in RepoInsight",
  description:
    "Every release we ship to RepoInsight. Follow along as we add new AI features, security audits, and improvements.",
  openGraph: {
    title: "RepoInsight AI — Changelog",
    description: "What's new in RepoInsight. Releases, improvements, and fixes.",
  },
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
