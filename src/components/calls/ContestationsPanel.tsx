'use client';
// Prompt 924 (Etapa 4, I3) — Results → Contestations. For whoever has "Handle contestations": the queue of the applicants' contestations, each with the application, the result it contests, the reason and the file, what the
// evaluations say as NUMBERS (never a comment) and the decision. Upheld (what the decision becomes: Advance or Waitlist; the applicant is told with a NEW result and the old one is kept) or Rejected (a written
// response is required and is sent). The confirmation is written in the page. The file is read by the server and downloaded from this platform — there is no Storage link here.
import { useCallback, useEffect, useState } from 'react';
import type { ContestationRow, ContestationsView } from '@/lib/calls/contestations';
import { formatInZone } from '@/lib/calls/tz';
import { callsApi } from './api';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40';
const TONE = { open: 'bg-amber-50 text-amber-900', upheld: 'bg-emerald-50 text-emerald-900', rejected: 'bg-gray-100 text-gray-700' } as const;
const STATUS = { open: 'Open', upheld: 'Upheld', rejected: 'Rejected' } as const;

export function ContestationsPanel({ callId }: { callId: string }) {
  const [view, setView] = useState<ContestationsView | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await callsApi.contestations(callId);
    if (!r.ok) { setError(r.body.error ?? 'Could not load the contestations.'); return; }
    setError(''); setView(r.body);
  }, [callId]);
  useEffect(() => { void load(); }, [load]);

  if (!view) return error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="contestations-error">{error}</p> : <p className="text-sm text-gray-400">Loading…</p>;
  return (
    <div className="min-w-0 space-y-3" data-testid="contestations-panel">
      {!view.enabled && <p className="rounded-lg bg-sky-50 px-4 py-2.5 text-xs text-sky-900" data-testid="contestations-off">Contestations are switched off for this call. An administrator can turn them on in Results → Prepare (they are {view.days} days long once on).</p>}
      <p className="text-sm text-gray-600" data-testid="contestations-count">{view.rows.length === 0 ? 'No applicant has contested a decision.' : `${view.open} waiting for an answer · ${view.rows.length} in all`}</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]">{error}</p>}
      <ul className="space-y-3">
        {view.rows.map((r) => <Item key={r.id} callId={callId} row={r} labels={view.labels} onView={(v) => { setView(v); setError(''); }} onError={setError} />)}
      </ul>
    </div>
  );
}

function Item({ callId, row, labels, onView, onError }: { callId: string; row: ContestationRow; labels: ContestationsView['labels']; onView: (v: ContestationsView) => void; onError: (e: string) => void }) {
  const [mode, setMode] = useState<'none' | 'upheld' | 'rejected'>('none');
  const [newResult, setNewResult] = useState<'advance' | 'waitlist'>('advance');
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true); onError('');
    const r = await callsApi.contestationAnswer(callId, { contestationId: row.id, outcome: mode as 'upheld' | 'rejected', ...(mode === 'upheld' ? { newResult } : {}), response });
    setBusy(false);
    if (!r.ok) { onError(r.body.error ?? 'Something went wrong. Please try again.'); return; }
    onView(r.body);
  }
  const sentence = mode === 'upheld'
    ? `Accept this contestation? The decision becomes “${labels[newResult]}”, the applicant is told with a new result, and the earlier one is kept. This cannot be undone.`
    : `Reject this contestation? The decision stands and your response is sent to the applicant. This cannot be undone.`;

  return (
    <li className="min-w-0 rounded-xl border border-gray-200 bg-white p-4" data-testid="contestation" data-status={row.status}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{row.startupName ?? row.reference ?? 'Application'}{row.reference && row.startupName ? ` (${row.reference})` : ''}</p>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[row.status]}`} data-testid="contestation-status">{STATUS[row.status]}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">Contested “{row.result.label}” · {formatInZone(row.createdAt, 'UTC')}</p>
      <p className="mt-2 text-xs font-medium text-gray-600">The applicant’s reason</p>
      <p className="min-w-0 whitespace-pre-line text-sm text-gray-800 [overflow-wrap:anywhere]" data-testid="contestation-reason">{row.reason}</p>
      {row.hasFile && <a className="mt-1 inline-block text-xs font-semibold text-[#0E7490] hover:underline [overflow-wrap:anywhere]" href={`/api/calls/${callId}/contestations/${row.id}/file`} data-testid="contestation-file">Download {row.fileName ?? 'the file'}</a>}
      {row.evaluation && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3" data-testid="contestation-evaluation">
          <p className="text-xs font-medium text-gray-600">What the evaluations say</p>
          <p className="text-sm text-gray-800">{row.evaluation.gradePercent === null ? 'No grade yet' : `Average ${row.evaluation.gradePercent}%`} · {row.evaluation.evaluators} evaluation{row.evaluation.evaluators === 1 ? '' : 's'} · decision: {row.evaluation.decision ?? 'none'}{row.evaluation.decisionNote ? ` (“${row.evaluation.decisionNote}”)` : ''}</p>
          {row.evaluation.criteria.length > 0 && <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">{row.evaluation.criteria.map((c) => <li key={c.name} className="min-w-0 text-xs text-gray-600 [overflow-wrap:anywhere]">{c.name}: {c.average ?? '—'}</li>)}</ul>}
        </div>
      )}
      {row.status !== 'open' && (
        <div className="mt-3 border-t border-gray-100 pt-2" data-testid="contestation-answer">
          <p className="text-xs font-medium text-gray-600">Answered {formatInZone(row.answeredAt, 'UTC')}{row.newLabel ? ` · the applicant now has “${row.newLabel}”` : ''}</p>
          {row.response && <p className="min-w-0 whitespace-pre-line text-sm text-gray-800 [overflow-wrap:anywhere]">{row.response}</p>}
        </div>
      )}
      {row.status === 'open' && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {mode === 'none' ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN} data-testid="answer-upheld" onClick={() => setMode('upheld')}>Upheld…</button>
              <button type="button" className={BTN} data-testid="answer-rejected" onClick={() => setMode('rejected')}>Rejected…</button>
            </div>
          ) : (
            <div className="space-y-2" data-testid="answer-form">
              {mode === 'upheld' && (
                <div role="radiogroup" aria-label="What the decision becomes" className="flex flex-wrap gap-4 text-sm">
                  {(['advance', 'waitlist'] as const).map((k) => <label key={k} className="flex items-center gap-2"><input type="radio" name={`nr-${row.id}`} checked={newResult === k} onChange={() => setNewResult(k)} data-testid={`new-${k}`} /> {labels[k]}</label>)}
                </div>
              )}
              <label htmlFor={`resp-${row.id}`} className="block text-xs font-medium text-gray-700">{mode === 'rejected' ? 'Response to the applicant (required)' : 'Response to the applicant (optional)'}</label>
              <textarea id={`resp-${row.id}`} rows={4} autoComplete="off" className={INPUT} maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} data-testid="answer-response" />
              <p className="text-sm font-medium text-gray-900" data-testid="answer-sentence">{sentence}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} disabled={busy || (mode === 'rejected' && !response.trim())} data-testid="answer-send" onClick={() => void send()}>{busy ? 'Sending…' : mode === 'upheld' ? 'Accept the contestation' : 'Reject the contestation'}</button>
                <button type="button" className={BTN} disabled={busy} data-testid="answer-cancel" onClick={() => setMode('none')}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
