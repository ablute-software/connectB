'use client';
// Prompt 924 (Etapa 4, I3) — Results → Close. "Complete call" (only once every phase is published, the contestation period is over and no contestation is open; the name of the call is typed IN THE PAGE to confirm),
// the final export (CSV or Excel, for whoever has "Final decision"), and the retention: the date the applicants' data is deleted, the warning 30 days before, and the one postponement with a reason. After the call is
// completed everything is read-only except this.
import { useCallback, useEffect, useState } from 'react';
import { confirmationMatches } from '@/lib/calls/results';
import type { CloseView } from '@/lib/calls/contestations';
import { formatDayInZone } from '@/lib/calls/tz';
import { callsApi } from './api';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50';
const BTN = 'inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40';
const CARD = 'min-w-0 rounded-xl border border-gray-200 bg-white p-4';

export function ClosePanel({ callId }: { callId: string }) {
  const [view, setView] = useState<CloseView | null>(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [postponing, setPostponing] = useState(false);

  const load = useCallback(async () => {
    const r = await callsApi.closeView(callId);
    if (!r.ok) { setError(r.body.error ?? 'Could not load this.'); return; }
    setError(''); setView(r.body);
  }, [callId]);
  useEffect(() => { void load(); }, [load]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; body: CloseView & { error?: string } }>) {
    setBusy(label); setError('');
    const r = await fn();
    setBusy('');
    if (!r.ok) { setError(r.body.error ?? 'Something went wrong. Please try again.'); return; }
    setView(r.body); setTyped(''); setReason(''); setPostponing(false);
  }

  if (!view) return error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="close-error">{error}</p> : <p className="text-sm text-gray-400">Loading…</p>;
  const done = view.status === 'completed';
  const ret = view.retention;
  const day = (iso: string | null) => formatDayInZone(iso, view.timezone);

  return (
    <div className="min-w-0 space-y-4" data-testid="close-panel">
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="close-error">{error}</p>}

      {done ? (
        <section className={`${CARD} border-teal-200 bg-teal-50`} data-testid="completed-box">
          <h2 className="text-sm font-semibold text-teal-900">Completed</h2>
          <p className="mt-1 text-sm text-teal-900">This call was completed on {day(view.completedAt)}. Everything in it is read-only.</p>
        </section>
      ) : (
        <section className={CARD} data-testid="complete-box">
          <h2 className="text-sm font-semibold text-gray-900">Complete the call</h2>
          <p className="mt-1 text-xs text-gray-500">{view.summary.total} published result{view.summary.total === 1 ? '' : 's'}{view.contestations.enabled ? ` · ${view.contestations.total} contestation${view.contestations.total === 1 ? '' : 's'}, ${view.contestations.open} open` : ''}. Completing is the end: everything becomes read-only and the applicants’ data starts its countdown.</p>
          {view.blockers.map((b) => <p key={b.code} role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid={`blocker-${b.code}`}>{b.text}</p>)}
          {view.canComplete && (
            <>
              <p className="mt-3 text-sm font-medium text-gray-900" data-testid="complete-sentence">Complete this call? Everything becomes read-only. This cannot be undone.</p>
              <label htmlFor="complete-name" className="mt-2 block text-xs font-medium text-gray-600">Type the name of the call to confirm: <span className="font-semibold text-gray-800 [overflow-wrap:anywhere]">{view.callName}</span></label>
              <input id="complete-name" autoComplete="off" className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="complete-name" />
              <button type="button" className={`${PRIMARY} mt-3`} disabled={!confirmationMatches(typed, view.callName) || !!busy} data-testid="complete-button" onClick={() => void run('complete', () => callsApi.closeComplete(callId, typed))}>{busy === 'complete' ? 'Working…' : 'Complete call'}</button>
            </>
          )}
        </section>
      )}

      <section className={CARD} data-testid="export-box">
        <h2 className="text-sm font-semibold text-gray-900">Final export</h2>
        <p className="mt-1 text-xs text-gray-500">The results, the decisions and the contestations, one row per published result. No private comment is ever in it. For whoever has “Final decision”.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a className={BTN} href={`/api/calls/${callId}/results/export?format=csv`} data-testid="export-csv">Download CSV</a>
          <a className={BTN} href={`/api/calls/${callId}/results/export?format=xlsx`} data-testid="export-xlsx">Download Excel</a>
        </div>
      </section>

      {done && (
        <section className={CARD} data-testid="retention-box" data-phase={ret.phase}>
          <h2 className="text-sm font-semibold text-gray-900">The applicants’ data</h2>
          {ret.phase === 'purged' ? (
            <p className="mt-1 text-sm text-gray-700">The applicants’ documents and answers were deleted. A summary without personal data stays.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-gray-700" data-testid="retention-sentence">Kept for {ret.months} months after the call was completed: deleted on <b>{day(ret.purgeAfter)}</b>{ret.daysLeft !== null ? ` (${ret.daysLeft} day${ret.daysLeft === 1 ? '' : 's'} left)` : ''}. Then their documents and answers go; only a summary without personal data stays.</p>
              {ret.phase === 'warn' && <p role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="retention-warning">The data will be deleted in less than 30 days. Export what you need, or postpone the deletion.</p>}
              {ret.extendedAt && <p className="mt-2 text-xs text-gray-500" data-testid="retention-postponed">Postponed once on {day(ret.extendedAt)}{ret.reason ? `: “${ret.reason}”` : ''}. It cannot be postponed again.</p>}
              {ret.canPostpone && (!postponing ? (
                <button type="button" className={`${BTN} mt-2`} data-testid="postpone-open" onClick={() => setPostponing(true)}>Postpone the deletion…</button>
              ) : (
                <div className="mt-2 space-y-2" data-testid="postpone-form">
                  <label htmlFor="postpone-reason" className="block text-xs font-medium text-gray-700">Why? (required — you can postpone only once, by 6 months)</label>
                  <textarea id="postpone-reason" rows={3} autoComplete="off" className={INPUT} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="postpone-reason" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={PRIMARY} disabled={reason.trim().length < 5 || !!busy} data-testid="postpone-send" onClick={() => void run('postpone', () => callsApi.closePostpone(callId, reason))}>{busy === 'postpone' ? 'Working…' : 'Postpone by 6 months'}</button>
                    <button type="button" className={BTN} disabled={!!busy} onClick={() => setPostponing(false)}>Cancel</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
