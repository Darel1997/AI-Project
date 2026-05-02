export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-3" role="status" aria-label="Loading">
        <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
        <p className="text-text-muted text-sm">Loading…</p>
      </div>
    </div>
  );
}
