import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { PreferencesProvider } from "@/hooks/usePreferences";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://repoinsight.ai";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "RepoInsight",
    template: "%s · RepoInsight",
  },
  description:
    "AI-powered codebase analysis for engineering teams. Chat with your code, auto-generate documentation, scan for security issues, and onboard new developers in under 30 minutes.",
  keywords: [
    "codebase analysis",
    "AI code review",
    "code documentation generator",
    "developer onboarding",
    "GitHub code intelligence",
    "semantic code search",
    "Anthropic Claude",
    "RAG for code",
  ],
  authors: [{ name: "RepoInsight" }],
  creator: "RepoInsight",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "RepoInsight AI",
    title: "RepoInsight",
    description:
      "Chat with your code, auto-generate documentation, scan for security issues, and onboard new developers in under 30 minutes.",
    images: [
      { url: "/og-image.png", width: 1200, height: 630, alt: "RepoInsight AI dashboard preview" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RepoInsight",
    description:
      "AI-powered codebase analysis for engineering teams. Built on Anthropic Claude.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Pre-hydration script — runs before React mounts so the user's preferred
  // theme / font-size / density is applied on the first paint, not after a flash.
  // Reading localStorage in a tiny synchronous script is the standard pattern
  // used by Vercel, Linear, Stripe etc. for the same reason.
  const prefBootstrap = `
    (function () {
      try {
        var raw = localStorage.getItem('ri:prefs');
        if (!raw) return;
        var p = JSON.parse(raw);
        var html = document.documentElement;
        if (p.theme) {
          var t = p.theme === 'system'
            ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
            : p.theme;
          html.dataset.theme = t;
        }
        if (p.fontSize) html.dataset.fontSize = p.fontSize;
        if (p.density)  html.dataset.density  = p.density;
        if (p.contrast) html.dataset.contrast = p.contrast;
        if (p.motion) {
          var m = p.motion === 'system'
            ? (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full')
            : p.motion;
          html.dataset.motion = m;
        }
      } catch (e) { /* fail silent — defaults still apply */ }
    })();
  `;

  return (
    <html lang="en" className="dark">
      <head>
        {/* Inline script — must run before <body> renders. Suppress hydration
            warning because we mutate document at render time. */}
        <script dangerouslySetInnerHTML={{ __html: prefBootstrap }} />
      </head>
      <body className="font-sans">
        {/* Skip-to-content link — invisible until focused, critical for keyboard users (WCAG 2.4.1) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-accent focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:outline-2 focus:outline-white focus:outline-offset-2"
        >
          Skip to main content
        </a>
        <PreferencesProvider>
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
