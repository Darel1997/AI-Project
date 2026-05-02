import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-6">
      <div className="max-w-md w-full text-center space-y-6 animate-fade-in">
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full" aria-hidden="true" />
          <p className="relative text-[120px] leading-none font-bold text-gradient tracking-tight">404</p>
        </div>
        <div className="space-y-2">
          <h1 className="text-display-3">Page not found</h1>
          <p className="text-text-secondary text-pretty">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link href="/" className="btn-primary px-6">
            Go home
          </Link>
          <Link href="/dashboard" className="btn-secondary px-6">
            Open dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
