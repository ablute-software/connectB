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
//
// Prompt 647 §2 — the same dialog can carry a field or two (a revisit date,
// an optional reason) and hand their values back: useConfirmWithFields()
// resolves the values, or null on Cancel. One dialog, not a second modal
// for the one flow that needs an input; useConfirm() is unchanged for every
// existing caller.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmField {
  key: string;
  label: string;
  type: 'date' | 'text';
  defaultValue?: string;
  placeholder?: string;
  min?: string;
}

export type ConfirmValues = Record<string, string>;

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // The red-button variant, for delete/revoke/purge — anything that used to
  // rely on the browser's own default confirm() styling to signal "this is
  // the dangerous one." Same normal-vs-destructive distinction, just styled.
  destructive?: boolean;
  fields?: ConfirmField[];
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (values: ConfirmValues | null) => void;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmValues | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

function defaultsOf(fields: ConfirmField[] | undefined): ConfirmValues {
  const out: ConfirmValues = {};
  for (const f of fields ?? []) out[f.key] = f.defaultValue ?? '';
  return out;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [values, setValues] = useState<ConfirmValues>({});
  // Guards against a resolve() firing twice (e.g. Escape then a click both
  // landing) — a Promise can only settle once anyway, but this also stops a
  // second dialog render from a stray extra call.
  const settledRef = useRef(false);

  const confirm = useCallback((opts: ConfirmOptions): Promise<ConfirmValues | null> => {
    return new Promise<ConfirmValues | null>((resolve) => {
      settledRef.current = false;
      setValues(defaultsOf(opts.fields));
      setPending({ ...opts, resolve });
    });
  }, []);

  function settle(ok: boolean) {
    if (settledRef.current || !pending) return;
    settledRef.current = true;
    pending.resolve(ok ? values : null);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => settle(false)}>
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {pending.title && <h2 className="text-sm font-bold text-gray-900">{pending.title}</h2>}
            <p className={`whitespace-pre-line text-sm text-gray-700 ${pending.title ? 'mt-1' : ''}`}>{pending.message}</p>
            {pending.fields?.map((f) => (
              <label key={f.key} className="mt-3 block text-xs font-medium text-gray-600">
                {f.label}
                <input
                  type={f.type}
                  value={values[f.key] ?? ''}
                  min={f.min}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); settle(true); } }}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-normal text-gray-900"
                />
              </label>
            ))}
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

function fallbackConfirm(opts: ConfirmOptions): Promise<ConfirmValues | null> {
  // Fallback if ever rendered outside ConfirmProvider (shouldn't happen —
  // it's mounted at the app root — but degrading to the native confirm
  // is safer than silently returning false for every destructive action
  // a caller might otherwise never notice was skipped).
  console.error('[useConfirm] used outside ConfirmProvider — falling back to window.confirm');
  const ok = typeof window !== 'undefined' ? window.confirm(opts.message) : false;
  return Promise.resolve(ok ? defaultsOf(opts.fields) : null);
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  return useMemo(() => async (opts: ConfirmOptions) => (await (confirm ?? fallbackConfirm)(opts)) !== null, [confirm]);
}

/** Prompt 647 §2 — the same dialog, with its fields' values on Confirm and null on Cancel. */
export function useConfirmWithFields(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  return useMemo(() => confirm ?? fallbackConfirm, [confirm]);
}
