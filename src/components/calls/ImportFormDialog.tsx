'use client';
// Prompt 909 (I2) — "Import form from another call": choose one of your organisation's calls (archived ones too),
// look at its form, choose Replace or Add after the current form, confirm. No AI. The server does the copying and
// reports what it had to drop (a display condition pointing at a question that did not come).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FormField } from '@/lib/calls/types';
import type { ImportMode, ImportSource } from '@/lib/calls/form-import';
import { CALL_STATUS_LABELS, type CallStatus } from '@/lib/calls/types';
import { callsApi } from './api';
import { FormPreview } from './FormPreview';

export interface ImportOutcome { ok: boolean; error?: string; code?: string; summary?: string }

export function ImportFormDialog({ callId, currentFieldCount, onClose, onImport }: {
  callId: string; currentFieldCount: number; onClose: () => void;
  onImport: (sourceCallId: string, mode: ImportMode, confirmReplace: boolean) => Promise<ImportOutcome>;
}) {
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; currency: string; fields: FormField[] } | null>(null);
  const [mode, setMode] = useState<ImportMode>(currentFieldCount > 0 ? 'add' : 'replace');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void callsApi.importSources(callId).then((r) => {
      if (!r.ok) { setError(r.body.error ?? 'Could not load your calls.'); setSources([]); return; }
      setSources(r.body.sources);
    });
  }, [callId]);

  async function choose(id: string) {
    setPick(id); setPreview(null); setError('');
    const r = await callsApi.importSources(callId, id);
    if (!r.ok || !r.body.preview) { setError(r.body.error ?? 'Could not load that form.'); return; }
    setPreview(r.body.preview);
  }

  async function run() {
    if (!pick) return;
    if (mode === 'replace' && currentFieldCount > 0
      && !window.confirm(`This replaces the ${currentFieldCount} field${currentFieldCount === 1 ? '' : 's'} of the current form. Continue?`)) return;
    setBusy(true); setError('');
    const res = await onImport(pick, mode, mode === 'replace' && currentFieldCount > 0);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Could not import the form.'); return; }
    onClose();
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Import form from another call" data-testid="import-form-dialog">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-bold text-gray-900">Import form from another call</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800" aria-label="Close">✕</button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[260px_minmax(0,1fr)]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Your organisation’s calls</p>
            {sources === null ? <p className="mt-2 text-xs text-gray-400">Loading…</p> : sources.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500" data-testid="no-sources">There is no other call to import from yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {sources.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => void choose(s.id)} data-testid={`source-${s.id}`}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${pick === s.id ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <span className="block font-semibold text-gray-900">{s.name}</span>
                      <span className="text-gray-500">{CALL_STATUS_LABELS[s.effectiveStatus as CallStatus] ?? s.effectiveStatus} · {s.fields} field{s.fields === 1 ? '' : 's'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0">
            {!pick ? <p className="text-sm text-gray-400">Choose a call to see its form before importing it.</p>
              : !preview ? <p className="text-sm text-gray-400">Loading the form…</p>
              : preview.fields.length === 0 ? <p className="text-sm text-gray-500">That call has no form yet, so there is nothing to import.</p>
              : (
                <div className="rounded-lg border border-gray-200 p-3" data-testid="import-preview">
                  <p className="mb-2 text-[11px] text-gray-500">Preview of “{preview.name}”: nothing is saved here.</p>
                  <FormPreview fields={preview.fields} currency={preview.currency} title={preview.name} />
                </div>
              )}
          </div>
        </div>
        <div className="border-t border-gray-200 px-5 py-3">
          <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" aria-label="How to import">
            <label className="flex items-center gap-1.5"><input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace current form</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="import-mode" checked={mode === 'add'} onChange={() => setMode('add')} /> Add after current form</label>
            <span className="text-[11px] text-gray-500">{mode === 'add' ? 'The imported pages come after the existing ones.' : currentFieldCount > 0 ? `Replaces the ${currentFieldCount} existing field${currentFieldCount === 1 ? '' : 's'} (you will be asked to confirm).` : 'The current form is empty.'}</span>
          </fieldset>
          {error && <p role="alert" className="mt-2 text-xs text-[#B00000]" data-testid="import-error">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="button" disabled={!pick || !preview || preview.fields.length === 0 || busy} onClick={() => void run()} data-testid="import-confirm"
              className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">{busy ? 'Importing…' : 'Import'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
