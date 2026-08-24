'use client';
// Prompt 364 — every window.confirm() in the app replaced by one shared,
// app-styled dialog. Generalizes PropagationConfirm.tsx's own already-
// approved pattern (createPortal(..., document.body), SSR guard, white
// rounded card, Cancel + action button) rather than inventing a new one —
// per CLAUDE.md's own overlay rule, and because a second, slightly
// different confirm modal would just be a second thing to keep in sync.
//
// useConfirm() returns a function that resolves a Promise<boolean>, so a
// call site reads almost exactly like the window.confirm() it replaces:
//   if (await confirm({ message: '...' })) { ... }
// A chained second confirm (documents/page.tsx's delete-folder flow) falls
// out naturally: `await confirm(...)` twice in sequence, no special casing.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // The red-button variant, for delete/revoke/purge — anything that used to
  // rely on the browser's own default confirm() styling to signal "this is
  // the dangerous one." Same normal-vs-destructive distinction, just styled.
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Guards against a resolve() firing twice (e.g. Escape then a click both
  // landing) — a Promise can only settle once anyway, but this also stops a
  // second dialog render from a stray extra call.
  const settledRef = useRef(false);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      settledRef.current = false;
      setPending({ ...opts, resolve });
    });
  }, []);

  function settle(value: boolean) {
    if (settledRef.current || !pending) return;
    settledRef.current = true;
    pending.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => settle(false)}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {pending.title && <h2 className="text-sm font-bold text-gray-900">{pending.title}</h2>}
            <p className={`text-sm text-gray-700 ${pending.title ? 'mt-1' : ''}`}>{pending.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => settle(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button onClick={() => settle(true)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${pending.destructive ? 'bg-[#B00000] hover:bg-[#960000]' : 'bg-[#0E7490] hover:bg-[#0c6379]'}`}>
                {pending.confirmLabel ?? (pending.destructive ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  return useMemo(() => confirm ?? (async (opts: ConfirmOptions) => {
    // Fallback if ever rendered outside ConfirmProvider (shouldn't happen —
    // it's mounted at the app root — but degrading to the native confirm
    // is safer than silently returning false for every destructive action
    // a caller might otherwise never notice was skipped).
    console.error('[useConfirm] used outside ConfirmProvider — falling back to window.confirm');
    return typeof window !== 'undefined' ? window.confirm(opts.message) : false;
  }), [confirm]);
}
