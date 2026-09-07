'use client';
// Prompt 576 Fase 3 — the destructive-action side panel for Suspend/Delete,
// shared by Startups and Investors (and, per the plan, adopted by the
// Suspicious Accounts queue in a later phase — see this file's own props:
// nothing here is org- or investor-specific, that lives in
// moderation-cascade-copy.ts, which the caller reads and passes in).
//
// Prompt 580 §B.3 — generalized once a second, genuinely different caller
// appeared (the catalog merge tool, a different endpoint and payload shape
// entirely): `onConfirm` replaces a hardcoded fetch to
// /api/backoffice/moderation/${action}, so this panel now only owns the
// UI contract (cascade preview, reason required, confirm/cancel) and every
// caller owns its own request. ModerationControls still supplies its own
// onConfirm that fetches the moderation endpoint exactly as before — this
// is additive, not a behavior change for Fase 3's existing usage.
//
// Portal-rendered for the same reason WelcomeModal/HelpSupportWidget/
// BackofficeSearch are: an ancestor with backdrop-blur/filter/etc. silently
// becomes the containing block for a `fixed` descendant otherwise (see
// CLAUDE.md's own incident note on this), and a table row three components
// deep is exactly the kind of place that hazard hides.
//
// Confirm disables until a reason is typed — the InlineClassify.tsx /
// pass_requires_reason pattern already established elsewhere in this
// codebase — not the validate-on-click shape ModerationControls used before
// this panel existed. Undo keeps that older inline shape: it is a recovery
// action, not a destructive one, and the spec's own scope names only
// Suspend/Delete for the panel.
import { useState } from 'react';
import { createPortal } from 'react-dom';

export type PanelAction = 'suspend' | 'delete';

export const ACTION_VERB: Record<PanelAction, string> = { suspend: 'Suspend', delete: 'Delete' };

export function AccountActionPanel({ title, name, cascadeLines, confirmLabel, reasonPlaceholder, onConfirm, onClose, onDone }: {
  /** Shown as the small uppercase kicker above the name — "Suspend" / "Delete" / "Merge". */
  title: string;
  name: string;
  cascadeLines: string[];
  /** Button label, e.g. "Confirm suspend" / "Confirm merge". */
  confirmLabel: string;
  reasonPlaceholder?: string;
  /** Owns the actual request; the panel only owns reason-required UI. */
  onConfirm: (reason: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (typeof document === 'undefined') return null;
  const canConfirm = reason.trim().length > 0;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true); setErr('');
    const result = await onConfirm(reason);
    setBusy(false);
    if (!result.ok) { setErr(result.error ?? 'Action failed.'); return; }
    onDone();
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={() => !busy && onClose()} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#B00000]">{title}</div>
            <h2 className="text-base font-bold text-gray-900">{name}</h2>
          </div>
          <button onClick={() => !busy && onClose()} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm font-medium text-gray-700">This removes:</p>
          <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
            {cascadeLines.map((line, i) => (
              <li key={i} className="flex gap-2"><span className="text-gray-300">—</span><span>{line}</span></li>
            ))}
          </ul>

          <label className="mt-5 block text-sm font-medium text-gray-700">
            Reason <span className="text-[#B00000]">(required)</span>
          </label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4}
            placeholder={reasonPlaceholder ?? 'Why is this account being suspended/deleted?'}
            className="mt-1.5 w-full rounded-lg border border-gray-300 p-2.5 text-sm" />
          {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-4">
          <button onClick={() => !busy && onClose()} disabled={busy}
            className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={() => void confirm()} disabled={!canConfirm || busy}
            className="ml-auto rounded-lg bg-[#B00000] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#900000] disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
