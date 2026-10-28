'use client';
// Prompt 922 (I4) — the evaluation board of a call, for administrators: how far the evaluation is (a progress bar and the numbers), the ranking by weighted average with the average of each criterion, the flags
// (divergence between evaluators, below an eliminatory minimum — they flag, never exclude), the grid version, and the FINAL DECISION of each application (Advance / Reject / Waitlist, with an optional note — nothing
// is sent to the applicant). "Close evaluation" and the CSV / Excel export belong to whoever has "Final decision". Confirmations and notes are IN the page.
import { useCallback, useEffect, useState } from 'react';
import { DECISION_LABEL, type BoardRow, type Decision } from '@/lib/calls/eval-board';
import type { Board } from '@/lib/calls/eval-board-store';
import { callsApi } from './api';
import { AutoTextarea } from './AutoTextarea';

const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';
const STATE_TEXT: Record<BoardRow['state'], { label: string; tone: string }> = {
  unassigned: { label: 'Nobody assigned', tone: 'bg-amber-50 text-amber-900' }, not_started: { label: 'Not started', tone: 'bg-gray-100 text-gray-700' },
  in_progress: { label: 'In progress', tone: 'bg-sky-50 text-sky-900' }, complete: { label: 'Complete', tone: 'bg-emerald-50 text-emerald-900' },
};
const DECISION_TONE: Record<Decision, string> = { advance: 'bg-emerald-50 text-emerald-900', reject: 'bg-red-50 text-[#8a0000]', waitlist: 'bg-amber-50 text-amber-900' };

export function EvaluationBoard({ callId, onOpen }: { callId: string; onOpen: (applicationId: string) => void }) {
  const [board, setBoard] = useState<(Board & { canDecide: boolean }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ id: string; decision: Decision | ''; note: string } | null>(null);

  const load = useCallback(async () => {
    const r = await callsApi.evaluationBoard(callId);
    if (!r.ok) { setError(r.body.error ?? 'Could not load the board.'); return; }
    setError(''); setBoard(r.body);
  }, [callId]);
  useEffect(() => { void load(); }, [load]);

  async function act(p: ReturnType<typeof callsApi.evaluationBoardAct>) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'That did not work. Please try again.'); return false; }
    setError(''); setBoard(r.body); return true;
  }

  if (!board) return <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600" data-testid="board-loading" role={error ? 'alert' : undefined}>{error || 'Loading the board…'}</p>;
  const p = board.progress;
  const pct = p.assigned > 0 ? Math.round((p.submitted / p.assigned) * 100) : 0;

  return (
    <section className="min-w-0 space-y-4" aria-label="Evaluation board" data-testid="board">
      <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">How far the evaluation is</h3>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Evaluations submitted" data-testid="board-bar"><div className="h-full rounded-full bg-[#0E7490]" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-sm text-gray-800" data-testid="board-progress">{p.submitted} of {p.assigned} evaluations submitted · {p.complete} of {p.applications} application{p.applications === 1 ? '' : 's'} complete{p.unassigned > 0 ? ` · ${p.unassigned} without evaluators` : ''}{` · ${p.decided} decided`}</p>
        <p className="mt-0.5 text-xs text-gray-500">Grid version in force: {board.version}. The ranking uses only submitted evaluations. A flag never changes a score and never excludes anybody.</p>
        {board.closed && <p className="mt-2 rounded bg-gray-100 px-3 py-2 text-sm text-gray-800" data-testid="board-closed">The evaluation is closed: evaluators cannot save or submit any more.</p>}
        {error && <p role="alert" className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-[#B00000]" data-testid="board-error">{error}</p>}
        {board.canDecide && (
          <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="board-actions">
            {board.closed
              ? <button type="button" className={BTN} disabled={busy} data-testid="board-reopen-all" onClick={() => void act(callsApi.evaluationBoardAct(callId, { action: 'reopen' }))}>Reopen the evaluation</button>
              : !confirmClose && <button type="button" className={BTN} disabled={busy} data-testid="board-close" onClick={() => setConfirmClose(true)}>Close evaluation…</button>}
            <a className={`${BTN} inline-flex items-center`} href={`/api/calls/${callId}/evaluation-board/export?format=csv`} data-testid="board-export-csv">Download CSV</a>
            <a className={`${BTN} inline-flex items-center`} href={`/api/calls/${callId}/evaluation-board/export?format=xlsx`} data-testid="board-export-xlsx">Download Excel</a>
            <span className="text-[11px] text-gray-500">The file has scores, flags and decisions — never a comment.</span>
          </div>
        )}
        {confirmClose && (
          <div className="mt-3 rounded-lg border border-[#0E7490] p-3" role="group" aria-label="Confirm closing the evaluation" data-testid="board-confirm-close">
            <p className="text-sm text-gray-800">Close the evaluation? Evaluators will no longer be able to save, submit or declare a conflict. You can reopen it later.</p>
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={busy} data-testid="board-close-yes" onClick={() => void act(callsApi.evaluationBoardAct(callId, { action: 'close' })).then(() => setConfirmClose(false))}>Yes, close it</button><button type="button" className={BTN} disabled={busy} onClick={() => setConfirmClose(false)}>Keep it open</button></div>
          </div>
        )}
      </div>

      {board.rows.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600" data-testid="board-empty">No application is being evaluated yet. Applications that are a Fit appear here once they are distributed.</p>}
      <ol className="space-y-2">
        {board.rows.map((r) => {
          const expanded = open.has(r.applicationId);
          const editing = edit?.id === r.applicationId;
          return (
            <li key={r.applicationId} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="board-row">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8F4F8] text-sm font-bold text-[#0E7490]" data-testid="board-rank" aria-label={r.rank ? `Rank ${r.rank}` : 'Not ranked'}>{r.rank ?? '–'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{r.reference ?? 'Application'}{r.startupName ? ` · ${r.startupName}` : ''}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-0.5 font-medium ${STATE_TEXT[r.state].tone}`} data-testid="board-state">{STATE_TEXT[r.state].label}</span><span className="text-gray-600" data-testid="board-count">{r.submitted} of {r.assigned} submitted</span>{r.decision && <span className={`rounded-full px-2 py-0.5 font-medium ${DECISION_TONE[r.decision.decision]}`} data-testid="board-decision">{DECISION_LABEL[r.decision.decision]}</span>}</p>
                  </div>
                </div>
                <div className="text-right" data-testid="board-average">{r.average === null ? <span className="text-sm text-gray-400">No grade yet</span> : <><span className="text-lg font-bold text-gray-900">{r.average} %</span>{r.deviation !== null && <span className="block text-[11px] text-gray-500">deviation {r.deviation}</span>}</>}</div>
              </div>
              {(r.divergence.length > 0 || r.below.length > 0) && (
                <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="board-flags">
                  {r.divergence.map((d, i) => <li key={`d${i}`} className="min-w-0 max-w-full rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-950 [overflow-wrap:anywhere]" data-testid="board-flag-divergence">⚠ {d.kind === 'total' ? `Evaluators are ${d.range} points apart in total` : `${d.name}: evaluators are ${d.range} points apart`}</li>)}
                  {r.below.map((b) => <li key={b.criterionId} className="min-w-0 max-w-full rounded bg-red-50 px-2 py-0.5 text-xs text-[#8a0000] [overflow-wrap:anywhere]" data-testid="board-flag-below">Below the minimum on {b.name} ({b.evaluators} evaluator{b.evaluators === 1 ? '' : 's'})</li>)}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN} data-testid="board-open" onClick={() => onOpen(r.applicationId)}>Open evaluations</button>
                {r.perCriterion.length > 0 && <button type="button" className={BTN} aria-expanded={expanded} data-testid="board-toggle" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.applicationId)) n.delete(r.applicationId); else n.add(r.applicationId); return n; })}>{expanded ? 'Hide' : 'Show'} criteria</button>}
                {board.canDecide && !editing && <button type="button" className={BTN} data-testid="board-decide" onClick={() => setEdit({ id: r.applicationId, decision: r.decision?.decision ?? '', note: r.decision?.note ?? '' })}>{r.decision ? 'Change decision' : 'Decide…'}</button>}
              </div>
              {expanded && (
                <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 text-xs" data-testid="board-criteria">
                  {r.perCriterion.map((c) => <li key={c.criterionId} className="flex min-w-0 flex-wrap justify-between gap-x-3 px-3 py-1.5"><span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span><span className="text-gray-700">{c.average} · {c.percent} % · {c.count} evaluation{c.count === 1 ? '' : 's'}</span></li>)}
                </ul>
              )}
              {editing && edit && (
                <div className="mt-2 min-w-0 rounded-lg border border-gray-300 p-3" role="group" aria-label="Final decision" data-testid="board-decide-form">
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
                    {(['advance', 'waitlist', 'reject'] as Decision[]).map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={edit.decision === d} data-testid={`decide-${d}`} onClick={() => setEdit({ ...edit, decision: d })}
                        className={`min-h-[44px] rounded-lg border px-3 text-sm font-semibold sm:min-h-0 sm:py-1 sm:text-xs ${edit.decision === d ? 'border-[#0E7490] bg-[#0E7490] text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}>{DECISION_LABEL[d]}</button>
                    ))}
                  </div>
                  <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor={`dn-${r.applicationId}`}>Note (optional)</label>
                  <AutoTextarea id={`dn-${r.applicationId}`} multiline className="block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" value={edit.note} maxLength={1000} onChange={(note) => setEdit({ ...edit, note })} />
                  <p className="mt-1 text-[11px] text-gray-500">Nothing is sent to the applicant now: telling them is the next stage.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={PRIMARY} disabled={busy || edit.decision === ''} data-testid="decide-save" onClick={() => void act(callsApi.evaluationBoardAct(callId, { action: 'decide', applicationId: r.applicationId, decision: edit.decision || null, note: edit.note })).then((ok) => { if (ok) setEdit(null); })}>Save decision</button>
                    {r.decision && <button type="button" className={BTN} disabled={busy} data-testid="decide-clear" onClick={() => void act(callsApi.evaluationBoardAct(callId, { action: 'decide', applicationId: r.applicationId, decision: null })).then((ok) => { if (ok) setEdit(null); })}>Remove the decision</button>}
                    <button type="button" className={BTN} disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {r.decision?.note && !editing && <p className="mt-2 text-xs text-gray-700 [overflow-wrap:anywhere]" data-testid="board-decision-note">Note: {r.decision.note}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
