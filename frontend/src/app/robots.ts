import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://repoinsight.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/api/", "/dashboard", "/chat", "/analytics", "/settings", "/repos"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
