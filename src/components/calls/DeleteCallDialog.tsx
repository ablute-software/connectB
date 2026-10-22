'use client';
// Prompt 918 (Adenda 2, C) — the confirmation for deleting a call. It says WHAT goes (the numbers: submitted applications, applicants with a draft, uploaded files — never who), what is promised
// (it moves to "Deleted calls" and can be restored for 30 days; after that it is removed for good), that an open call is closed at once, and that the applicants are told — and only enables the button
// when the call's name has been typed. The server checks the name again; nothing here is the barrier. A full-viewport overlay, so it goes through a portal (an ancestor with a backdrop-filter would
// shrink it otherwise).
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { DELETE_NOTIFY_TEXT, DELETE_OPEN_TEXT, DELETE_RETENTION_TEXT, impactLines, nameMatches, type DeletionImpact } from '@/lib/calls/deletion';
import { callsApi } from './api';

export function DeleteCallDialog({ callId, name, onClose, onDeleted }: { callId: string; name: string; onClose: () => void; onDeleted: (r: { name: string; purgeAfter: string; notified: number }) => void }) {
  const [impact, setImpact] = useState<(DeletionImpact & { isOpen: boolean }) | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputId = useId();

  useEffect(() => {
    let alive = true;
    void callsApi.deleteImpact(callId).then((r) => { if (!alive) return; if (r.ok) setImpact(r.body); else setError(r.body.error ?? 'Could not check what deleting this call would remove.'); });
    return () => { alive = false; };
  }, [callId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function confirm() {
    setBusy(true); setError('');
    const r = await callsApi.remove(callId, typed);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'The call could not be deleted.'); return; }
    onDeleted({ name: r.body.name, purgeAfter: r.body.purgeAfter, notified: r.body.notified });
  }

  if (typeof document === 'undefined') return null;
  const matches = nameMatches(typed, name);
  const anyoneThere = !!impact && (impact.submitted > 0 || impact.drafts > 0);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!busy) onClose(); }} data-testid="delete-dialog-overlay">
      <div role="dialog" aria-modal="true" aria-labelledby={`${inputId}-title`} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="delete-dialog">
        <h2 id={`${inputId}-title`} className="text-base font-semibold text-gray-900">Delete “{name}”?</h2>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">This will delete</p>
        {impact === null ? <p className="mt-1 text-sm text-gray-400" data-testid="delete-impact-loading">{error || 'Checking…'}</p> : (
          <ul className="mt-1 list-disc pl-5 text-sm text-gray-800" data-testid="delete-impact">{impactLines(impact).map((l) => <li key={l}>{l}</li>)}</ul>
        )}
        <p className="mt-3 text-sm text-gray-700" data-testid="delete-retention">{DELETE_RETENTION_TEXT}</p>
        {impact?.isOpen && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="delete-open-note">{DELETE_OPEN_TEXT}</p>}
        {anyoneThere && <p className="mt-2 text-sm text-gray-700" data-testid="delete-notify">{DELETE_NOTIFY_TEXT}</p>}
        <label htmlFor={inputId} className="mt-4 block text-sm font-medium text-gray-900">Type the name of the call to confirm</label>
        <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus placeholder={name} data-testid="delete-confirm-name"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {error && impact !== null && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]" data-testid="delete-error">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" data-testid="delete-cancel">Cancel</button>
          <button type="button" onClick={() => void confirm()} disabled={!matches || busy || impact === null} data-testid="delete-confirm"
            className="min-h-[44px] rounded-lg bg-[#B00000] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8f0000] disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Deleting…' : 'Delete call'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
