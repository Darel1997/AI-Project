import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPost, getAllPosts, getRelatedPosts } from "@/content/blog";
import { MarketingNav } from "@/components/ui/MarketingNav";
import { MarketingFooter } from "@/components/ui/MarketingFooter";

interface Params {
  params: { slug: string };
}

export async function generateStaticParams() {
  return getAllPosts().map(p => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const post = getPost(params.slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author.name }],
    keywords: post.tags,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      authors: [post.author.name],
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

export default function BlogPostPage({ params }: Params) {
  const post = getPost(params.slug);
  if (!post) notFound();

  const related = getRelatedPosts(params.slug, 2);
  const Body = post.content;

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <MarketingNav />

      <main id="main-content" className="flex-1">
        {/* Back link */}
        <div className="max-w-3xl mx-auto px-6 pt-8">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-primary text-sm transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M13 16l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All posts
          </Link>
        </div>

        {/* Article */}
        <article className="max-w-3xl mx-auto px-6 py-10">
          <header className="mb-10 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              {post.tags.map(t => (
                <span key={t} className="badge-violet capitalize">{t}</span>
              ))}
            </div>
            <h1 className="text-display-2 text-balance">{post.title}</h1>
            <p className="text-lg text-text-secondary leading-relaxed text-pretty">
              {post.description}
            </p>
            <div className="flex items-center gap-4 text-sm text-text-muted pt-3 border-t border-white/5">
              <span className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-violet to-accent flex items-center justify-center text-white text-xs font-bold shadow-glow-sm">
                  {post.author.name[0]}
                </span>
                <span>{post.author.name}</span>
              </span>
              <span aria-hidden="true">·</span>
              <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
              <span aria-hidden="true">·</span>
              <span>{post.readingTime} min read</span>
            </div>
          </header>

          <div className="prose prose-invert max-w-none">
            <Body />
          </div>
        </article>

        {/* Related posts */}
        {related.length > 0 && (
          <aside className="max-w-3xl mx-auto px-6 py-12 border-t border-white/5" aria-labelledby="related-heading">
            <h2 id="related-heading" className="section-heading mb-5">Related reading</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {related.map(p => (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="card-hover p-5 group">
                  <p className="font-semibold text-sm group-hover:text-gradient transition-colors text-balance">
                    {p.title}
                  </p>
                  <p className="text-xs text-text-muted mt-2 line-clamp-2">{p.description}</p>
                </Link>
              ))}
            </div>
          </aside>
        )}

        {/* CTA */}
        <section className="max-w-3xl mx-auto px-6 py-16">
          <div className="card-glass p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-aurora opacity-50 pointer-events-none animate-aurora" aria-hidden="true" />
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-accent/20 rounded-full blur-3xl" aria-hidden="true" />
            <div className="relative space-y-4">
              <h2 className="text-2xl font-bold">Try RepoInsight <span className="text-gradient">free</span></h2>
              <p className="text-text-secondary text-sm max-w-md mx-auto">
                Unlimited public repositories. No credit card. Your first analysis takes under a minute.
              </p>
              <Link href="/auth?mode=register" className="btn-glow text-sm">
                Create an Account for Free
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
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
