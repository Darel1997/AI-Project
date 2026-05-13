"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

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
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus-trap covers initial focus AND restoration on close. The
  // previous hand-rolled trap broke whenever someone added a third
  // focusable element (e.g. a "Don't ask again" button).
  useFocusTrap(state !== null, dialogRef);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setState({ ...opts, resolve }));
  }, []);

  function close(result: boolean) {
    if (state) state.resolve(result);
    setState(null);
  }

  // Escape to dismiss. Tab is handled by useFocusTrap.
  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state) {
    return <ConfirmContext.Provider value={{ confirm }}>{children}</ConfirmContext.Provider>;
  }

  // Build aria attrs conditionally — aria-describedby pointing to a
  // non-existent ID is worse than not having it at all (some screen
  // readers report an error and skip the dialog name entirely).
  const describedById = state.description ? "confirm-desc" : undefined;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <div
        ref={dialogRef}
        className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={describedById}
        onClick={(e) => {
          if (e.target === e.currentTarget) close(false);
        }}
      >
        <div className="card shadow-card-hover p-6 max-w-md w-full space-y-4 animate-scale-in">
          <h2 id="confirm-title" className="text-lg font-semibold">
            {state.title}
          </h2>
          {state.description && (
            <p id="confirm-desc" className="text-text-secondary text-sm leading-relaxed">
              {state.description}
            </p>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={() => close(false)} className="btn-secondary text-sm">
              {state.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={() => close(true)}
              className={state.destructive ? "btn-danger text-sm" : "btn-primary text-sm"}
            >
              {state.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext).confirm;
}
