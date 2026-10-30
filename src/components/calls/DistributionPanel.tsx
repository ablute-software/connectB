'use client';
// Prompt 922 (I2) — Team → "Distribution of applications": who evaluates what. The mode (Automatic / Mixed / Manual), how many evaluators each application gets, the load of every evaluator, the applications that
// still lack evaluators, the conflicts of interest (automatic and declared — the reason a person gave is shown here and only here), "Redistribute" with a PREVIEW of what would change, and — where the mode
// allows — assigning and removing by hand. Nothing is a browser dialog: the preview and every refusal are in the page.
import { useCallback, useEffect, useState } from 'react';
import type { DistributionMode, DistributionView } from '@/lib/calls/eval-assign-store';
import { AllocationEditor } from './AllocationEditor';
import { callsApi, type DistributionPreview } from './api';

const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';

const MODES: { key: DistributionMode; label: string; hint: string }[] = [
  { key: 'auto', label: 'Automatic', hint: 'The platform distributes every Fit application by itself, evenly, and replaces an evaluator who has a conflict.' },
  { key: 'mixed', label: 'Mixed', hint: 'Automatic, and you can also assign or remove an evaluator by hand. A person you assign by hand stays unless there is a conflict.' },
  { key: 'manual', label: 'Manual', hint: 'The platform assigns nothing. You choose who evaluates each application.' },
];
const STATE_TEXT = { not_started: 'not started', in_progress: 'in progress', submitted: 'submitted' } as const;

export function DistributionPanel({ callId, canManage }: { callId: string; canManage: boolean }) {
  const [view, setView] = useState<DistributionView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DistributionPreview | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const r = await callsApi.distribution(callId);
    if (!r.ok) { setError(r.body.error ?? 'Could not load the distribution.'); return; }
    setError(''); setView(r.body);
  }, [callId]);
  useEffect(() => { void load(); }, [load]);

  async function run<T extends DistributionView>(p: Promise<{ ok: boolean; body: T & { error?: string } }>, done?: string) {
    setBusy(true); setNotice('');
    const r = await p;
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'That did not work. Please try again.'); return; }
    setError(''); setView(r.body); setPreview(null); if (done) setNotice(done);
  }

  async function openPreview() {
    setBusy(true); setNotice('');
    const r = await callsApi.distributionPreview(callId);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'Could not prepare the preview.'); return; }
    setError(''); setPreview(r.body);
  }

  if (!view) return <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500" data-testid="distribution-loading">{error || 'Loading the distribution…'}</section>;
  const editable = canManage && !busy;
  const nothing = preview && !preview.remove.length && !preview.add.length;
  const alloc = preview?.allocation ?? null;

  return (
    <section className="min-w-0 space-y-4 rounded-lg border border-gray-200 bg-white p-4" aria-label="Distribution of applications" data-testid="distribution">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Distribution of applications</h3>
        <p className="mt-1 text-xs text-gray-600">Only applications that were submitted and are a Fit are distributed. Evaluators are the people of the team with “Evaluate assigned applications”. Nobody evaluates an application they have a conflict of interest with.</p>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 px-2 py-1.5 text-xs text-[#B00000]" data-testid="distribution-error">{error}</p>}
      {notice && <p role="status" className="rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900" data-testid="distribution-notice">{notice}</p>}

      <fieldset disabled={!editable} className="min-w-0">
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">How applications are distributed</legend>
        <div className="mt-1 grid min-w-0 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Distribution mode">
          {MODES.map((m) => (
            <label key={m.key} className={`min-w-0 cursor-pointer rounded-lg border p-2.5 text-sm ${view.mode === m.key ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="flex items-center gap-2 font-semibold text-gray-900"><input type="radio" name="dist-mode" checked={view.mode === m.key} data-testid={`mode-${m.key}`} onChange={() => void run(callsApi.distributionMode(callId, m.key))} />{m.label}</span>
              <span className="mt-1 block text-xs text-gray-600">{m.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <AllocationEditor callId={callId} view={view} editable={editable} onView={(v) => { setView(v); setPreview(null); setError(''); }} />

      <p className="text-sm text-gray-800" data-testid="distribution-summary">
        {view.applications.length} application{view.applications.length === 1 ? '' : 's'} to evaluate · {view.evaluators.length} evaluator{view.evaluators.length === 1 ? '' : 's'} ·{' '}
        {view.evaluatorsPerApplication === 'all' ? 'every evaluator evaluates every application' : `${view.evaluatorsPerApplication} evaluator${view.evaluatorsPerApplication === 1 ? '' : 's'} per application`}
        <span className="text-gray-500"> (set in the Evaluation grid) · load shared {view.allocation.config.strategy === 'equal' ? 'equally' : view.allocation.config.strategy === 'weighted' ? 'by weight' : 'by rules'}</span>
      </p>
      {view.warning && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-950" data-testid="distribution-warning">⚠ {view.warning}</p>}
      {view.evaluators.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600" data-testid="no-evaluators">Nobody can evaluate yet. Give someone of the team the permission “Evaluate assigned applications”.</p>}

      {view.evaluators.length > 0 && (
        <div data-testid="evaluator-loads">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Load of each evaluator</h4>
          <ul className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {view.evaluators.map((e) => (
              <li key={e.userId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm" data-testid="evaluator-load">
                <span className="min-w-0 font-medium text-gray-900 [overflow-wrap:anywhere]">{e.name ?? e.email ?? 'Evaluator'}</span>
                <span className="text-xs text-gray-600">{e.assigned} assigned · {e.started} started · {e.submitted} submitted</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!editable || view.applications.length === 0} data-testid="redistribute" onClick={() => void openPreview()}>Redistribute…</button>
        <span className="text-xs text-gray-500">Shows what would change first. Nothing is applied until you confirm.</span>
      </div>

      {preview && (
        <div className="min-w-0 rounded-lg border border-[#0E7490] bg-white p-3" role="group" aria-label="What redistributing would change" data-testid="distribution-preview">
          <p className="text-sm font-semibold text-gray-900">{nothing ? 'Nothing would change.' : 'This is what would change'}</p>
          {preview.manual && <p className="mt-1 text-xs text-gray-600">The mode is Manual: only conflicts are taken out; nobody is assigned for you.</p>}
          {preview.remove.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-gray-800" data-testid="preview-remove">{preview.remove.map((r) => <li key={r.applicationId + r.userId} className="[overflow-wrap:anywhere]">− {r.evaluator} is taken off {r.reference} ({r.why})</li>)}</ul>}
          {preview.add.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-gray-800" data-testid="preview-add">{preview.add.map((r) => <li key={r.applicationId + r.userId} className="[overflow-wrap:anywhere]">+ {r.evaluator} gets {r.reference}</li>)}</ul>}
          {preview.keptWithConflict.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-amber-950" data-testid="preview-kept">{preview.keptWithConflict.map((r) => <li key={r.applicationId + r.userId} className="[overflow-wrap:anywhere]">⚠ {r.evaluator} has a conflict with {r.reference} but already started the evaluation: it stays, for you to decide.</li>)}</ul>}
          {preview.shortfalls.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-amber-950" data-testid="preview-short">{preview.shortfalls.map((r) => <li key={r.applicationId} className="[overflow-wrap:anywhere]">⚠ {r.reference} would have {r.got} of {r.wanted} evaluators: there are not enough people without a conflict.</li>)}</ul>}
          {preview.warning && <p className="mt-2 text-xs text-amber-950">⚠ {preview.warning}</p>}
          {alloc && (
            <div className="mt-3 min-w-0 space-y-2 border-t border-gray-100 pt-2" data-testid="preview-allocation">
              {alloc.problems.length > 0 && <ul className="space-y-0.5 text-xs text-amber-950" data-testid="preview-problems">{alloc.problems.map((p) => <li key={p} className="[overflow-wrap:anywhere]">⚠ {p}</li>)}</ul>}
              {alloc.evaluators.length > 0 && (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-xs" data-testid="preview-evaluators" aria-label="What each evaluator would get">
                  {alloc.evaluators.map((e) => <li key={e.userId} className="flex min-w-0 flex-wrap justify-between gap-x-3 px-3 py-1.5" data-testid="preview-evaluator"><span className="min-w-0 [overflow-wrap:anywhere]">{e.name}</span><span className="text-gray-700">{e.requested !== null ? `asked ${e.requested} % · ` : e.limit !== null ? `at most ${e.limit} · ` : ''}would have <b>{e.got}</b></span></li>)}
                </ul>
              )}
              {alloc.panels.map((p) => (
                <div key={p.panelId} className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-xs" data-testid="preview-panel">
                  <p className="font-semibold text-gray-900 [overflow-wrap:anywhere]">{p.name || 'Unnamed panel'} · {p.applications} application{p.applications === 1 ? '' : 's'}{p.short ? ' · smaller than the number of evaluators asked' : ''}</p>
                  <ul className="mt-1 space-y-0.5 text-gray-700">{p.evaluators.map((e) => <li key={e.userId} className="[overflow-wrap:anywhere]">{e.name}{e.requested !== null ? ` (asked ${e.requested} %)` : ''}: gets {e.got} more</li>)}</ul>
                </div>
              ))}
              {alloc.unassigned.length > 0 && <p className="text-xs text-amber-950" data-testid="preview-unassigned">Unassigned (meet no rule — for you to assign): {alloc.unassigned.map((u) => u.reference).join(', ')}.</p>}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy || (!nothing && !!alloc?.blocked)} data-testid="preview-apply" onClick={() => { if (nothing && alloc?.blocked) { setPreview(null); return; } void run(callsApi.distributionRedistribute(callId), 'Redistributed. Each evaluator who received something was told.'); }}>{busy ? 'Applying…' : nothing ? 'Close' : 'Apply'}</button>
            {!nothing && <button type="button" className={BTN} disabled={busy} data-testid="preview-cancel" onClick={() => setPreview(null)}>Cancel</button>}
          </div>
        </div>
      )}

      {view.applications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600" data-testid="no-applications">No application to evaluate yet. A submitted application appears here once its eligibility is Fit.</p>
      ) : (
        <div data-testid="distribution-applications">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Who evaluates what</h4>
          <ul className="mt-1 space-y-2">
            {view.applications.map((a) => {
              const free = view.evaluators.filter((e) => !a.evaluators.some((x) => x.userId === e.userId));
              return (
                <li key={a.applicationId} className="min-w-0 rounded-lg border border-gray-200 p-2.5" data-testid="distribution-application">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                    <p className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{a.reference ?? 'Application'}{a.startupName ? ` · ${a.startupName}` : ''}</p>
                    {a.short && <span className="text-xs font-medium text-amber-900" data-testid="application-short">⚠ needs {a.needed} more evaluator{a.needed === 1 ? '' : 's'}</span>}
                  </div>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {a.evaluators.map((e) => (
                      <li key={e.userId} className="flex min-w-0 items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-2.5 pr-1 text-xs text-gray-800" data-testid="assigned-evaluator">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{e.name ?? 'Evaluator'} · {STATE_TEXT[e.status]}{e.source === 'manual' ? ' · by hand' : ''}</span>
                        {a.byHand && e.status === 'not_started' && (
                          <button type="button" aria-label={`Take ${e.name ?? 'the evaluator'} off ${a.reference ?? 'this application'}`} disabled={!editable} data-testid="unassign" onClick={() => void run(callsApi.distributionMove(callId, 'unassign', a.applicationId, e.userId))} className="min-h-[28px] min-w-[28px] rounded-full text-gray-500 hover:text-[#B00000] disabled:opacity-40">✕</button>
                        )}
                      </li>
                    ))}
                    {a.evaluators.length === 0 && <li className="text-xs text-gray-500">Nobody yet.</li>}
                  </ul>
                  {a.byHand && free.length > 0 && (
                    <label className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-700">Assign to
                      <select className="min-w-0 max-w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" disabled={!editable} value="" data-testid="assign-select" onChange={(e) => { if (e.target.value) void run(callsApi.distributionMove(callId, 'assign', a.applicationId, e.target.value)); }}>
                        <option value="">Choose…</option>{free.map((e) => <option key={e.userId} value={e.userId}>{e.name ?? e.email}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {view.conflicts.length > 0 && (
        <div data-testid="distribution-conflicts">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Conflicts of interest</h4>
          <ul className="mt-1 space-y-1.5">
            {view.conflicts.map((c, i) => (
              <li key={`${c.applicationId}-${c.userId}-${i}`} className="min-w-0 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-800 [overflow-wrap:anywhere]" data-testid="conflict">
                <b>{c.evaluator ?? 'An evaluator'}</b> {c.text} — {c.reference ?? 'an application'} <span className="text-gray-500">({c.kind === 'declared' ? 'declared' : 'found by the platform'}{c.resolved ? ', not assigned' : ', still assigned'})</span>
                {c.note && <span className="mt-0.5 block text-gray-700" data-testid="conflict-note">Reason given (only you see this): “{c.note}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
