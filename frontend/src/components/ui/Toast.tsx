"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    const duration = t.durationMs ?? 5000;
    setToasts(prev => [...prev, { id, ...t }]);
    if (duration > 0) setTimeout(() => remove(id), duration);
  }, [remove]);

  const value: ToastContextValue = {
    toast,
    success: (title, description) => toast({ kind: "success", title, description }),
    error: (title, description) => toast({ kind: "error", title, description, durationMs: 7000 }),
    info: (title, description) => toast({ kind: "info", title, description }),
    warning: (title, description) => toast({ kind: "warning", title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [isLeaving, setIsLeaving] = useState(false);

  const handleDismiss = () => {
    setIsLeaving(true);
    setTimeout(onDismiss, 200);
  };

  useEffect(() => {
    // Entrance animation handled via Tailwind animate-slide-up
  }, []);

  const styles: Record<ToastKind, { ring: string; icon: ReactNode; iconBg: string }> = {
    success: {
      ring: "border-success/30",
      iconBg: "bg-success/15 text-success",
      icon: <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M4 10l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    },
    error: {
      ring: "border-danger/30",
      iconBg: "bg-danger/15 text-danger",
      icon: <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9v4h2V9H9zm0-4v2h2V5H9z" clipRule="evenodd" /></svg>,
    },
    warning: {
      ring: "border-warning/30",
      iconBg: "bg-warning/15 text-warning",
      icon: <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 11a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>,
    },
    info: {
      ring: "border-accent/30",
      iconBg: "bg-accent/15 text-accent",
      icon: <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>,
    },
  };

  const s = styles[toast.kind];

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto card ${s.ring} shadow-card-hover p-3.5 flex items-start gap-3 transition-all duration-200 ${isLeaving ? "opacity-0 translate-x-4" : "animate-slide-up"}`}
    >
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${s.iconBg}`}>
        {s.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary">{toast.title}</p>
        {toast.description && (
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{toast.description}</p>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="shrink-0 text-text-muted hover:text-text-primary p-1 -m-1 rounded transition-colors"
        aria-label="Dismiss notification"
      >
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
