import type { MetadataRoute } from "next";
import { getAllPosts } from "@/content/blog";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://repoinsight.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const posts = getAllPosts().map(p => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.updatedAt || p.publishedAt),
    changeFrequency: "yearly" as const,
    priority: 0.6,
  }));
  return [
    { url: `${SITE_URL}/`,          lastModified: now, changeFrequency: "monthly", priority: 1.0 },
    { url: `${SITE_URL}/pricing`,    lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/enterprise`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/security`,   lastModified: now, changeFrequency: "monthly", priority: 0.85 },
    { url: `${SITE_URL}/status`,     lastModified: now, changeFrequency: "daily",   priority: 0.5 },
    { url: `${SITE_URL}/blog`,       lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    { url: `${SITE_URL}/changelog`, lastModified: now, changeFrequency: "weekly",  priority: 0.7 },
    { url: `${SITE_URL}/auth`,      lastModified: now, changeFrequency: "yearly",  priority: 0.5 },
    ...posts,
  ];
}
