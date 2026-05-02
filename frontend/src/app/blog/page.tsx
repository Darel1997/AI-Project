import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts, getFeaturedPost } from "@/content/blog";
import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";
export const metadata: Metadata = {
  title: "Blog — Engineering essays from the RepoInsight team",
  description:
    "Deep-dives on AI-powered code analysis, RAG architecture, security scanning, and the engineering lessons we learn along the way.",
  openGraph: {
    title: "RepoInsight Blog",
    description: "Engineering essays on AI-powered codebase analysis.",
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();
  const featured = getFeaturedPost();
  const rest = featured ? posts.filter(p => p.slug !== featured.slug) : posts;

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <MarketingNav />

      <main id="main-content" className="flex-1 max-w-5xl mx-auto px-6 py-16 w-full">
        <header className="mb-12 max-w-2xl">
          <p className="eyebrow mb-4">
            <span className="status-dot" aria-hidden="true" />
            Blog
          </p>
          <h1 className="text-display-2 text-balance">Engineering essays from the <span className="text-gradient">RepoInsight team</span></h1>
          <p className="text-text-secondary text-lg mt-4 text-pretty">
            Deep-dives on AI-powered code analysis, RAG architecture, security scanning, and the engineering lessons we learn along the way.
          </p>
        </header>

        {/* Featured post */}
        {featured && (
          <Link
            href={`/blog/${featured.slug}`}
            className="card-glass block p-10 mb-12 relative overflow-hidden group hover:ring-1 hover:ring-accent/30 transition-all"
          >
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-accent/15 rounded-full blur-3xl group-hover:bg-accent/25 transition-colors" aria-hidden="true" />
            <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet/15 rounded-full blur-3xl" aria-hidden="true" />
            <div className="relative space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge-violet">Featured</span>
                {featured.tags.slice(0, 3).map(t => (
                  <span key={t} className="badge-gray capitalize">{t}</span>
                ))}
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold group-hover:text-gradient transition-colors text-balance">
                {featured.title}
              </h2>
              <p className="text-text-secondary text-base leading-relaxed text-pretty max-w-3xl">
                {featured.description}
              </p>
              <div className="flex items-center gap-4 text-xs text-text-muted pt-2">
                <span>{featured.author.name}</span>
                <span>·</span>
                <time dateTime={featured.publishedAt}>{formatDate(featured.publishedAt)}</time>
                <span>·</span>
                <span>{featured.readingTime} min read</span>
              </div>
            </div>
          </Link>
        )}

        {/* All posts grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rest.map(post => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="card-hover p-6 flex flex-col group"
            >
              <div className="flex items-center gap-2 flex-wrap mb-3">
                {post.tags.slice(0, 2).map(t => (
                  <span key={t} className="badge-gray capitalize">{t}</span>
                ))}
              </div>
              <h3 className="text-lg font-semibold group-hover:text-accent transition-colors mb-2 text-balance">
                {post.title}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed mb-4 text-pretty flex-1">
                {post.description}
              </p>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                <span aria-hidden="true">·</span>
                <span>{post.readingTime} min read</span>
              </div>
            </Link>
          ))}
        </div>
      </main>

      <MarketingFooter compact />
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
