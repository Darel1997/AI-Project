import type { ReactNode } from "react";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  author: {
    name: string;
    role?: string;
    avatar?: string;
  };
  publishedAt: string;       // ISO date
  updatedAt?: string;
  tags: string[];
  readingTime: number;       // minutes
  featured?: boolean;
  /**
   * JSX content rendered by the blog page. Use the `B` namespace
   * helpers (H2, P, Code, Quote, List, etc.) for consistent styling.
   */
  content: () => ReactNode;
}

/**
 * All posts. Order matters: newest first. Each post is a separate
 * file under /content/blog/ for clean git diffs per post.
 */
import { introducingRepoInsight } from "./introducing-repoinsight";
import { whyRAGForCode } from "./why-rag-for-code";
import { howWeBuiltSecurityScanner } from "./how-we-built-security-scanner";

export const BLOG_POSTS: BlogPost[] = [
  introducingRepoInsight,
  whyRAGForCode,
  howWeBuiltSecurityScanner,
];

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find(p => p.slug === slug);
}

export function getAllPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

export function getFeaturedPost(): BlogPost | undefined {
  return BLOG_POSTS.find(p => p.featured);
}

export function getRelatedPosts(slug: string, limit = 3): BlogPost[] {
  const current = getPost(slug);
  if (!current) return [];
  // Sort by tag overlap, then date
  return BLOG_POSTS
    .filter(p => p.slug !== slug)
    .map(p => ({
      post: p,
      score: p.tags.filter(t => current.tags.includes(t)).length,
    }))
    .sort((a, b) => b.score - a.score || new Date(b.post.publishedAt).getTime() - new Date(a.post.publishedAt).getTime())
    .slice(0, limit)
    .map(x => x.post);
}
