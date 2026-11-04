'use client';
// Prompt 925 — Setup → "Selection rules": the minimum score (in the unit of the call), a minimum per criterion, the places, the budget (a fixed amount per project, or the amount each project asks for), the quotas
// over closed answers of the form (a minimum and/or a maximum of places), the waiting list and the tie-break chain. The impossible is said as it is written, and a preview with INVENTED applications shows what
// the rules do. The rules give a PROPOSAL on the evaluation board; nobody is decided by them. Editable until the evaluation closes; every change is a new version.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { callsApi } from './api';
import type { Criterion, Scoring } from '@/lib/calls/eval-grid';
import { DEFAULT_RULES, minTotalUnit, propose, ruleWarnings, sampleCandidates, type Quota, type SelectionRules, type TieStep } from '@/lib/calls/selection';

interface FieldView { id: string; label: string; kind: 'single_choice' | 'multiple_choice' | 'yes_no' | 'number'; options: { id: string; label: string }[] }
interface View { canEdit: boolean; lockedReason: string | null; version: number; rules: SelectionRules; criteria: Criterion[]; scoring: Scoring; fields: FieldView[] }

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const CARD = 'rounded-lg border border-gray-200 bg-white p-4';
const num = (v: string): number | null => (v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const OUTCOME_PILL: Record<string, string> = { selected: 'bg-emerald-100 text-emerald-900', waitlist: 'bg-amber-100 text-amber-900', reject: 'bg-gray-200 text-gray-700', not_considered: 'bg-gray-100 text-gray-500' };
const OUTCOME_LABEL: Record<string, string> = { selected: 'Advance', waitlist: 'Waitlist', reject: 'Reject', not_considered: 'Not considered' };

/** The order of the calculation, as it is written on the screen and in the report. */
export const CALCULATION_ORDER = [
  'Only applications that are Fit and have a final score take part.',
  'The minimums are applied (the total, and each criterion): whoever fails goes to Reject, with the reason.',
  'The rest are ordered by the final score, with the tie-break below.',
  'The minimum places of the quotas are filled with the best of each category.',
  'The remaining places are filled in order, respecting each quota’s maximum and the budget.',
  'The next ones go to the waiting list.',
  'Everybody else goes to Reject (“Not within the available places”).',
] as const;

export function SelectionRulesStep({ callId, canManage, onVersion }: { callId: string; canManage: boolean; onVersion?: (v: number) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [rules, setRules] = useState<SelectionRules>(DEFAULT_RULES);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    const r = await callsApi.getSelectionRules(callId);
    if (!r.ok) { setLoadError(r.body.error ?? 'The selection rules could not be loaded.'); return; }
    const b = r.body as unknown as View;
    setView(b); setRules({ ...DEFAULT_RULES, ...b.rules }); setDirty(false); setError('');
    onVersion?.(b.version);
  }, [callId, onVersion]);
  useEffect(() => { void load(); }, [load]);

  const patch = (p: Partial<SelectionRules>) => { setRules((r) => ({ ...r, ...p })); setDirty(true); setSaved(''); };
  const editable = !!view?.canEdit && canManage;
  const warnings = useMemo(() => (view ? ruleWarnings(rules, view.criteria, view.scoring) : []), [rules, view]);
  const preview = useMemo(() => (view ? propose({ rules, criteria: view.criteria, scoring: view.scoring, candidates: sampleCandidates(rules, view.criteria, view.fields) }) : null), [rules, view]);
  if (loadError) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="selection-loading">{loadError}</p>;
  if (!view) return <p className="text-sm text-gray-500" data-testid="selection-loading">Loading…</p>;

  const { unit, max } = minTotalUnit(view.criteria, view.scoring);
  const unitText = unit === 'points' ? `points, out of ${max}` : unit === 'scale' ? `on the scale, out of ${max}` : '%';
  const numberFields = view.fields.filter((f) => f.kind === 'number');
  const fieldOf = (id: string) => view.fields.find((f) => f.id === id);
  const critName = (id: string) => view.criteria.find((c) => c.id === id)?.name ?? 'a criterion';

  async function save() {
    setBusy(true); setError(''); setSaved('');
    const withManual: TieStep[] = [...rules.tieBreak.filter((t) => t.kind === 'criterion'), { kind: 'manual' }];       // a tie nobody can break is always left to a person
    const r = await callsApi.putSelectionRules(callId, view!.version, { ...rules, tieBreak: withManual });
    setBusy(false);
    if (!r.ok) { const message = r.body.error ?? 'The rules could not be saved.'; if (r.body.code === 'conflict') await load(); setError(message); return; }
    setSaved('Saved.'); await load();
  }

  const setQuota = (i: number, q: Partial<Quota>) => patch({ quotas: rules.quotas.map((x, k) => (k === i ? { ...x, ...q } : x)) });
  const addQuota = () => { const f = view.fields[0]; if (!f) return; patch({ quotas: [...rules.quotas, newQuota(f, rules.quotas.length)] }); };
  const move = (i: number, d: -1 | 1) => { const c = rules.tieBreak.filter((t) => t.kind === 'criterion'); const j = i + d; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j], c[i]]; patch({ tieBreak: c }); };
  const tieCriteria = rules.tieBreak.filter((t): t is Extract<TieStep, { kind: 'criterion' }> => t.kind === 'criterion');

  return (
    <div className="min-w-0 space-y-4" data-testid="selection-step">
      <div className={CARD}>
        <h3 className="text-sm font-semibold text-gray-900">How the selection works</h3>
        <p className="mt-1 text-xs text-gray-600">The platform <b>proposes</b> Advance / Waitlist / Reject, explained application by application. Nothing is decided until someone with “Final decision” applies the proposal, and every decision can be changed with a reason. Always the same result for the same applications and rules: never by order of arrival, never by a draw.</p>
        <details className="mt-2 text-xs text-gray-700"><summary className="cursor-pointer font-medium text-[#0E7490]">The order of the calculation</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5" data-testid="calculation-order">{CALCULATION_ORDER.map((s) => <li key={s}>{s}</li>)}</ol>
        </details>
        {view.lockedReason && <p className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700" data-testid="selection-locked">{view.lockedReason}</p>}
      </div>

      <fieldset disabled={!editable} className="min-w-0 space-y-4">
        <div className={CARD}>
          <h3 className="text-sm font-semibold text-gray-900">Minimums</h3>
          <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
            <div><label className={LABEL} htmlFor="sel-min-total">Minimum final score ({unitText})</label>
              <input id="sel-min-total" data-testid="sel-min-total" inputMode="decimal" autoComplete="off" className={INPUT} value={rules.minTotal ?? ''} onChange={(e) => patch({ minTotal: num(e.target.value) })} placeholder="No minimum" />
              <p className="mt-1 text-[11px] text-gray-500">Below it an application is rejected, whatever the places.</p></div>
          </div>
          <p className={`${LABEL} mt-3`}>Minimum per criterion (average of the evaluators)</p>
          <ul className="mt-1 grid min-w-0 gap-2 sm:grid-cols-2">
            {view.criteria.map((c) => {
              const cur = rules.minPerCriterion.find((m) => m.criterionId === c.id)?.min;
              return (
                <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <label className="min-w-0 basis-full text-sm text-gray-800 [overflow-wrap:anywhere] sm:flex-1 sm:basis-0 sm:truncate" htmlFor={`sel-min-${c.id}`} title={c.name}>{c.name} <span className="text-[11px] text-gray-400">({c.scaleMin}–{c.scaleMax}{c.minScore !== null ? `; the grid already requires ${c.minScore}` : ''})</span></label>
                  <input id={`sel-min-${c.id}`} data-testid="sel-min-criterion" inputMode="decimal" autoComplete="off" className={`${INPUT} w-20 shrink-0`} value={cur ?? ''} placeholder="—"
                    onChange={(e) => { const n = num(e.target.value); patch({ minPerCriterion: [...rules.minPerCriterion.filter((m) => m.criterionId !== c.id), ...(n === null ? [] : [{ criterionId: c.id, min: n }])] }); }} />
                </li>
              );
            })}
          </ul>
        </div>

        <div className={CARD}>
          <h3 className="text-sm font-semibold text-gray-900">Places, waiting list and budget</h3>
          <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
            <div><label className={LABEL} htmlFor="sel-slots">Places (projects selected)</label>
              <input id="sel-slots" data-testid="sel-slots" inputMode="numeric" autoComplete="off" className={INPUT} value={rules.slots ?? ''} onChange={(e) => patch({ slots: num(e.target.value) })} placeholder="No limit" /></div>
            <div><label className={LABEL} htmlFor="sel-waitlist">Waiting list (how many wait after the selected)</label>
              <input id="sel-waitlist" data-testid="sel-waitlist" inputMode="numeric" autoComplete="off" className={INPUT} value={rules.waitlist} onChange={(e) => patch({ waitlist: num(e.target.value) ?? 0 })} /></div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" data-testid="sel-budget-on" checked={!!rules.budget} onChange={(e) => patch({ budget: e.target.checked ? { total: 0, per: 'fixed', fixedAmount: null, fieldId: null } : null })} /> Use a budget</label>
          {rules.budget && (
            <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2" data-testid="sel-budget">
              <div><label className={LABEL} htmlFor="sel-budget-total">Total budget</label>
                <input id="sel-budget-total" data-testid="sel-budget-total" inputMode="numeric" autoComplete="off" className={INPUT} value={rules.budget.total || ''} onChange={(e) => patch({ budget: { ...rules.budget!, total: num(e.target.value) ?? 0 } })} /></div>
              <div><span className={LABEL}>Amount per project</span>
                <div className="mt-1 flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" name="sel-per" checked={rules.budget.per === 'fixed'} onChange={() => patch({ budget: { ...rules.budget!, per: 'fixed', fieldId: null } })} /> A fixed amount</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="sel-per" data-testid="sel-per-asked" checked={rules.budget.per === 'asked'} onChange={() => patch({ budget: { ...rules.budget!, per: 'asked', fixedAmount: null, fieldId: numberFields[0]?.id ?? null } })} /> What each project asks for</label>
                </div></div>
              {rules.budget.per === 'fixed'
                ? <div><label className={LABEL} htmlFor="sel-fixed">Fixed amount per project</label><input id="sel-fixed" data-testid="sel-fixed" inputMode="numeric" autoComplete="off" className={INPUT} value={rules.budget.fixedAmount ?? ''} onChange={(e) => patch({ budget: { ...rules.budget!, fixedAmount: num(e.target.value) } })} /></div>
                : <div><label className={LABEL} htmlFor="sel-asked-field">The question that holds the amount asked</label>
                    <select id="sel-asked-field" data-testid="sel-asked-field" className={INPUT} value={rules.budget.fieldId ?? ''} onChange={(e) => patch({ budget: { ...rules.budget!, fieldId: e.target.value || null } })}>
                      <option value="">Choose a number question…</option>{numberFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>{numberFields.length === 0 && <p className="mt-1 text-[11px] text-amber-800">The form has no number question yet.</p>}</div>}
              <p className="text-[11px] text-gray-500 sm:col-span-2">With places and a budget, the first limit reached counts. A project that does not fit is skipped — the proposal says so — and the next one that fits is taken.</p>
            </div>
          )}
        </div>

        <div className={CARD}>
          <h3 className="text-sm font-semibold text-gray-900">Quotas</h3>
          <p className="mt-1 text-xs text-gray-600">Reserve or limit places by a closed answer of the form: a choice, Yes/No or a range of a number. If a minimum cannot be met, the places go back to the general list and the proposal says so.</p>
          <ul className="mt-2 space-y-2">
            {rules.quotas.map((q, i) => {
              const f = fieldOf(q.fieldId);
              return (
                <li key={q.id} className="min-w-0 rounded-lg border border-gray-200 p-3" data-testid="quota">
                  <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <select aria-label="Question" className={INPUT} value={q.fieldId} onChange={(e) => { const nf = fieldOf(e.target.value); if (nf) setQuota(i, newQuota(nf, i, q)); }}>
                      {view.fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                    {f?.kind === 'yes_no' && <select aria-label="Answer" className={INPUT} value={q.match.kind} onChange={(e) => setQuota(i, { match: { kind: e.target.value === 'no' ? 'no' : 'yes' }, label: `${f.label.slice(0, 50)}: ${e.target.value === 'no' ? 'No' : 'Yes'}` })}><option value="yes">Yes</option><option value="no">No</option></select>}
                    {f && (f.kind === 'single_choice' || f.kind === 'multiple_choice') && <select aria-label="Answer" data-testid="quota-option" className={INPUT} value={q.match.kind === 'option' ? q.match.optionId : ''} onChange={(e) => setQuota(i, { match: { kind: 'option', optionId: e.target.value }, label: f.options.find((o) => o.id === e.target.value)?.label ?? q.label })}>{f.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
                    {f?.kind === 'number' && q.match.kind === 'range' && (
                      <div className="flex min-w-0 items-center gap-2"><input aria-label="From" className={INPUT} inputMode="numeric" autoComplete="off" placeholder="From" value={q.match.min ?? ''} onChange={(e) => setQuota(i, { match: { kind: 'range', min: num(e.target.value), max: (q.match as { max: number | null }).max } })} />
                        <input aria-label="To" className={INPUT} inputMode="numeric" autoComplete="off" placeholder="To" value={q.match.max ?? ''} onChange={(e) => setQuota(i, { match: { kind: 'range', min: (q.match as { min: number | null }).min, max: num(e.target.value) } })} /></div>)}
                  </div>
                  <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <div><label className={LABEL}>At least</label><input data-testid="quota-min" inputMode="numeric" autoComplete="off" className={INPUT} placeholder="—" value={q.minSeats ?? ''} onChange={(e) => setQuota(i, { minSeats: num(e.target.value) })} /></div>
                    <div><label className={LABEL}>At most</label><input data-testid="quota-max" inputMode="numeric" autoComplete="off" className={INPUT} placeholder="—" value={q.maxSeats ?? ''} onChange={(e) => setQuota(i, { maxSeats: num(e.target.value) })} /></div>
                    <button type="button" className="self-end rounded-lg px-2 py-1.5 text-xs text-[#B00000] hover:bg-red-50" onClick={() => patch({ quotas: rules.quotas.filter((_, k) => k !== i) })}>Remove</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <button type="button" data-testid="add-quota" disabled={view.fields.length === 0} onClick={addQuota} className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">+ Add a quota</button>
          {view.fields.length === 0 && <p className="mt-1 text-[11px] text-gray-500">Quotas can be set once the form has a choice, Yes/No or number question.</p>}
        </div>

        <div className={CARD}>
          <h3 className="text-sm font-semibold text-gray-900">Tie-break</h3>
          <p className="mt-1 text-xs text-gray-600">When two applications have the same final score, in this order: a criterion, then another…, and in the end <b>a person decides</b> (marked “Tie — decide”). Never by order of arrival or by a draw.</p>
          <ol className="mt-2 space-y-1.5" data-testid="tie-chain">
            {tieCriteria.map((t, i) => (
              <li key={t.criterionId} className="flex min-w-0 items-center gap-2 text-sm"><span className="w-5 text-gray-400">{i + 1}.</span><span className="min-w-0 flex-1 truncate">{critName(t.criterionId)}</span>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded px-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30">↑</button>
                <button type="button" aria-label="Move down" disabled={i === tieCriteria.length - 1} onClick={() => move(i, 1)} className="rounded px-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30">↓</button>
                <button type="button" aria-label="Remove" onClick={() => patch({ tieBreak: tieCriteria.filter((_, k) => k !== i) })} className="rounded px-1.5 text-gray-400 hover:text-[#B00000]">✕</button></li>
            ))}
            <li className="flex items-center gap-2 text-sm text-gray-600"><span className="w-5 text-gray-400">{tieCriteria.length + 1}.</span>A person decides (“Tie — decide”)</li>
          </ol>
          <select aria-label="Add a criterion to the tie-break" data-testid="tie-add" className={`${INPUT} mt-2 max-w-xs`} value="" onChange={(e) => { if (e.target.value) patch({ tieBreak: [...tieCriteria, { kind: 'criterion', criterionId: e.target.value }] }); }}>
            <option value="">+ Add a criterion…</option>{view.criteria.filter((c) => !tieCriteria.some((t) => t.criterionId === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </fieldset>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status" data-testid="selection-warnings">
          {warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}

      <div className={CARD} data-testid="selection-preview">
        <h3 className="text-sm font-semibold text-gray-900">Preview with example data</h3>
        <p className="mt-1 text-xs text-gray-600">Twelve invented applications, to see what these rules do. Nothing here is real data.</p>
        {preview && (
          <ul className="mt-2 divide-y divide-gray-100 text-sm">
            {preview.items.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((i) => (
              <li key={i.applicationId} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5" data-testid="preview-row">
                <span className="w-6 shrink-0 text-right text-xs text-gray-400">{i.rank ?? '–'}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_PILL[i.outcome]}`}>{OUTCOME_LABEL[i.outcome]}</span>
                <span className="min-w-0 flex-1 text-gray-700 [overflow-wrap:anywhere]">{i.explanation}</span>
              </li>
            ))}
          </ul>
        )}
        {preview && <p className="mt-2 text-xs text-gray-600" data-testid="preview-summary">{preview.summary.selected} selected · {preview.summary.waitlist} on the waiting list · {preview.summary.rejected} rejected{preview.summary.budgetUsed !== null ? ` · budget used ${preview.summary.budgetUsed}, left ${preview.summary.budgetLeft}` : ''}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {editable && <button type="button" data-testid="selection-save" disabled={busy || !dirty} onClick={() => void save()} className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">{busy ? 'Saving…' : 'Save selection rules'}</button>}
        {dirty && editable && <span className="text-xs text-gray-500" data-testid="selection-dirty">Not saved yet</span>}
        {saved && <span role="status" className="text-xs text-emerald-800" data-testid="selection-saved">{saved} Version {view.version}.</span>}
        {error && <span role="alert" className="text-xs text-[#B00000]" data-testid="selection-error">{error}</span>}
        {!editable && !view.lockedReason && <span className="text-xs text-gray-500">Only people who can configure this call change these rules.</span>}
      </div>
    </div>
  );
}

function newQuota(f: FieldView, i: number, keep?: Partial<Quota>): Quota {
  const match: Quota['match'] = f.kind === 'yes_no' ? { kind: 'yes' } : f.kind === 'number' ? { kind: 'range', min: null, max: null } : { kind: 'option', optionId: f.options[0]?.id ?? '' };
  const label = match.kind === 'option' ? (f.options[0]?.label ?? f.label) : match.kind === 'yes' ? `${f.label.slice(0, 50)}: Yes` : `${f.label.slice(0, 50)} (range)`;
  return { id: keep?.id ?? `q${Date.now().toString(36)}${i}`, fieldId: f.id, label, match, minSeats: keep?.minSeats ?? 1, maxSeats: keep?.maxSeats ?? null };
}
