import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Simple plans that scale with you",
  description:
    "Free for public repositories. Pay only for private repos or team features. 3 plans — Free, Pro, and Team. Cancel anytime.",
  openGraph: {
    title: "RepoInsight AI — Pricing",
    description: "Simple pricing. Free for public repos, paid plans start at $15/mo.",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
