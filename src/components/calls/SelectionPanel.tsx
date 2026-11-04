'use client';
// Prompt 925 — the selection PROPOSAL on the evaluation board, for whoever has "Final decision": "Propose selection" calculates it from the rules of Setup → Selection rules; every application shows the sentence that
// explains it; the summary says who is selected, who waits, who is rejected, the budget used and left, the quotas met and the ties nobody decided; "Apply proposal" fills the decisions (each can still be changed,
// with a reason). A tie that matters is decided here, by a person, before anything is applied. The proposal says when it is out of date. Confirmations are IN the page.
import { useCallback, useEffect, useState } from 'react';
import { callsApi } from './api';

interface Item { applicationId: string; rank: number | null; outcome: 'selected' | 'waitlist' | 'reject' | 'not_considered'; explanation: string; tie: boolean; budgetSkipped: boolean; reference: string | null; startupName: string | null; amount: number | null }
interface Run {
  id: string; rulesVersion: number; createdAt: string; appliedAt: string | null; stale: boolean; differing: number; items: Item[];
  summary: { selected: number; waitlist: number; rejected: number; notConsidered: number; budgetUsed: number | null; budgetLeft: number | null; places: number | null; ties: string[]; skipped: string[]; quotas: { quotaId: string; label: string; selected: number; minSeats: number | null; maxSeats: number | null; met: boolean }[] };
}
interface View { canDecide: boolean; hasRules: boolean; rulesVersion: number; locked: boolean; run: Run | null; missingEvaluations: number; rulesStale: boolean; warnings: string[] }

const PILL: Record<Item['outcome'], string> = { selected: 'bg-emerald-100 text-emerald-900', waitlist: 'bg-amber-100 text-amber-900', reject: 'bg-gray-200 text-gray-700', not_considered: 'bg-gray-100 text-gray-500' };
const LABEL: Record<Item['outcome'], string> = { selected: 'Advance', waitlist: 'Waitlist', reject: 'Reject', not_considered: 'Not considered' };
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';

export function SelectionPanel({ callId, onChanged }: { callId: string; onChanged: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const r = await callsApi.selectionRun(callId);
    if (!r.ok) { setView(null); return; }
    setView(r.body as unknown as View);
  }, [callId]);
  useEffect(() => { void load(); }, [load]);
  if (!view) return null;

  async function go(body: Parameters<typeof callsApi.selectionAct>[1], message?: (v: View & { applied?: { written: number; keptManual: number; locked: number; unchanged: number } }) => string) {
    setBusy(true); setError(''); setSaid('');
    const r = await callsApi.selectionAct(callId, body);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'That did not work. Please try again.'); return; }
    const v = r.body as unknown as View & { applied?: { written: number; keptManual: number; locked: number; unchanged: number } };
    setView(v); setOrder(null);
    if (message) setSaid(message(v));
    onChanged();
  }

  const run = view.run;
  const ties = run ? run.items.filter((i) => i.tie) : [];
  const order0 = order ?? ties.map((t) => t.applicationId);
  const byId = new Map((run?.items ?? []).map((i) => [i.applicationId, i]));
  const move = (i: number, d: -1 | 1) => { const o = [...order0]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); };
  const outOfDate = !!run && (run.stale || view.rulesStale);

  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-4" data-testid="selection-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Selection proposal</h3>
        <button type="button" className="text-xs font-medium text-[#0E7490] hover:underline" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="selection-toggle">{open ? 'Hide' : 'Show'}</button>
      </div>
      {!open && run && <p className="mt-1 text-xs text-gray-600" data-testid="selection-line">{run.summary.selected} to advance · {run.summary.waitlist} on the waiting list · {run.summary.rejected} to reject{run.appliedAt ? ' · applied' : ' · not applied yet'}{outOfDate ? ' · out of date' : ''}</p>}
      {!open && !run && <p className="mt-1 text-xs text-gray-600">{view.hasRules ? 'No proposal yet.' : 'No selection rules yet (Setup → Selection rules).'}</p>}
      {open && (
        <div className="mt-2 space-y-3">
          {!view.hasRules && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="selection-norules">The selection rules are not set yet. Write them in <b>Setup → Selection rules</b>; the platform then proposes who advances, who waits and who is rejected.</p>}
          {view.locked && <p className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-800" data-testid="selection-fixed">The results were published: the selection is fixed.</p>}
          {view.warnings.length > 0 && <ul className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">{view.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
          {view.canDecide && view.hasRules && !view.locked && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={PRIMARY} disabled={busy} data-testid="selection-propose" onClick={() => void go({ action: 'propose' }, (v) => `Proposal calculated: ${v.run?.summary.selected ?? 0} to advance.`)}>{run ? 'Recalculate proposal' : 'Propose selection'}</button>
              {view.missingEvaluations > 0 && <span className="text-xs text-amber-800" data-testid="selection-missing">{view.missingEvaluations} evaluation{view.missingEvaluations === 1 ? '' : 's'} missing; the proposal may change.</span>}
            </div>
          )}
          {outOfDate && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" data-testid="selection-stale">The proposal is out of date: {view.rulesStale ? 'the rules changed' : 'the evaluations changed'} since it was calculated. Recalculating never deletes a decision a person made; it shows where they differ.</p>}

          {run && (
            <>
              <p className="text-sm text-gray-800" data-testid="selection-summary">
                <b>{run.summary.selected}</b> to advance{run.summary.places !== null ? ` (of ${run.summary.places} places)` : ''} · <b>{run.summary.waitlist}</b> on the waiting list · <b>{run.summary.rejected}</b> to reject{run.summary.notConsidered > 0 ? ` · ${run.summary.notConsidered} not considered` : ''}
                {run.summary.budgetUsed !== null && <> · budget used <b>{run.summary.budgetUsed}</b>, left <b>{run.summary.budgetLeft}</b></>}
              </p>
              {run.summary.quotas.length > 0 && <ul className="flex flex-wrap gap-1.5 text-xs" data-testid="selection-quotas">{run.summary.quotas.map((q) => <li key={q.quotaId} className={`rounded-full px-2 py-0.5 ${q.met ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>{q.label}: {q.selected}{q.minSeats !== null ? ` (min ${q.minSeats})` : ''}{q.maxSeats !== null ? ` (max ${q.maxSeats})` : ''}{q.met ? '' : ' — not met'}</li>)}</ul>}
              {run.summary.skipped.length > 0 && <p className="text-xs text-amber-900" data-testid="selection-skipped">⚠ {run.summary.skipped.length} project{run.summary.skipped.length === 1 ? ' was' : 's were'} skipped for the budget although better placed than one that was taken.</p>}
              {run.differing > 0 && <p className="text-xs text-gray-700" data-testid="selection-differ">{run.differing} decision{run.differing === 1 ? ' differs' : 's differ'} from this proposal.</p>}

              {ties.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="selection-ties">
                  <p className="text-sm font-semibold text-amber-950">Tie — decide</p>
                  <p className="mt-0.5 text-xs text-amber-900">These applications cannot be told apart by the tie-break and it matters for who is selected. Put them in the order you decide (first = best); nothing can be applied until you do.</p>
                  <ol className="mt-2 space-y-1">{order0.map((id, i) => (
                    <li key={id} className="flex min-w-0 items-center gap-2 text-sm"><span className="w-5 text-gray-500">{i + 1}.</span><span className="min-w-0 flex-1 truncate">{byId.get(id)?.reference} · {byId.get(id)?.startupName ?? '—'}</span>
                      {view.canDecide && <><button type="button" aria-label="Move up" className="rounded px-1.5 hover:bg-white" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button type="button" aria-label="Move down" className="rounded px-1.5 hover:bg-white" disabled={i === order0.length - 1} onClick={() => move(i, 1)}>↓</button></>}</li>))}</ol>
                  {view.canDecide && !view.locked && <button type="button" className={`${PRIMARY} mt-2`} disabled={busy} data-testid="selection-ties-save" onClick={() => void go({ action: 'ties', order: order0 }, () => 'Order saved and the proposal recalculated.')}>Save this order</button>}
                </div>
              )}

              <ul className="divide-y divide-gray-100 text-sm" data-testid="selection-items">
                {run.items.map((i) => (
                  <li key={i.applicationId} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5" data-testid="selection-item">
                    <span className="w-6 shrink-0 text-right text-xs text-gray-400">{i.rank ?? '–'}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[i.outcome]}`}>{LABEL[i.outcome]}</span>
                    <span className="shrink-0 font-mono text-[11px] text-gray-500">{i.reference}</span>
                    <span className="min-w-0 flex-1 text-gray-700 [overflow-wrap:anywhere]">{i.explanation}</span>
                  </li>
                ))}
              </ul>

              {view.canDecide && !view.locked && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={PRIMARY} data-testid="selection-apply" disabled={busy || run.summary.ties.length > 0 || outOfDate} title={outOfDate ? 'Recalculate first: the proposal is out of date.' : run.summary.ties.length > 0 ? 'Decide the ties first.' : undefined}
                    onClick={() => void go({ action: 'apply', runId: run.id }, (v) => `Applied: ${v.applied?.written ?? 0} decision${v.applied?.written === 1 ? '' : 's'} filled${v.applied?.keptManual ? `, ${v.applied.keptManual} made by a person left as they were` : ''}${v.applied?.locked ? `, ${v.applied.locked} fixed because their result is published` : ''}.`)}>{run.appliedAt ? 'Apply again' : 'Apply proposal'}</button>
                  <span className="text-xs text-gray-500">Fills Advance / Waitlist / Reject. A decision a person made is never overwritten.</span>
                </div>
              )}
            </>
          )}
          {said && <p role="status" className="text-xs text-emerald-800" data-testid="selection-said">{said}</p>}
          {error && <p role="alert" className="text-xs text-[#B00000]" data-testid="selection-panel-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
