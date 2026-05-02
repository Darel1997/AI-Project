"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue>({ confirm: async () => false });

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => setState({ ...opts, resolve }));
  }, []);

  function close(result: boolean) {
    if (state) state.resolve(result);
    setState(null);
  }

  // Focus confirm button on open + handle Escape
  useEffect(() => {
    if (!state) return;
    setTimeout(() => confirmBtnRef.current?.focus(), 50);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
      if (e.key === "Tab") {
        // Simple 2-button focus trap
        e.preventDefault();
        if (document.activeElement === confirmBtnRef.current) cancelBtnRef.current?.focus();
        else confirmBtnRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-desc"
          onClick={(e) => { if (e.target === e.currentTarget) close(false); }}
        >
          <div className="card shadow-card-hover p-6 max-w-md w-full space-y-4 animate-scale-in">
            <h2 id="confirm-title" className="text-lg font-semibold">{state.title}</h2>
            {state.description && (
              <p id="confirm-desc" className="text-text-secondary text-sm leading-relaxed">
                {state.description}
              </p>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <button ref={cancelBtnRef} onClick={() => close(false)} className="btn-secondary text-sm">
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmBtnRef}
                onClick={() => close(true)}
                className={state.destructive ? "btn-danger text-sm" : "btn-primary text-sm"}
              >
                {state.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext).confirm;
}
