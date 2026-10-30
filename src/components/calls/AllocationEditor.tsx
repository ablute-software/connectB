'use client';
// Prompt 922 (Adenda 1, C) — "How the load is shared" inside Team → Distribution of applications: Equal (as always), Weighted (a percentage of the load for each evaluator, adding up to 100 %, or a maximum number of
// applications) and By rules (panels of evaluators, and rules over the answers that send an application to a panel). The sentence under each choice says what it does; what is still missing is said in words and keeps the
// rules from being applied (never from being saved: they are saved as they are built). The first submitted evaluation freezes them: a change then makes a new version and asks first, IN the page.
import { useEffect, useMemo, useState } from 'react';
import { allocProblems, type AllocConfig, type Condition, type Panel, type Rule, type Strategy } from '@/lib/calls/eval-allocation';
import type { DistributionView } from '@/lib/calls/eval-assign-store';
import { callsApi } from './api';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';

const STRATEGIES: { key: Strategy; label: string; hint: string }[] = [
  { key: 'equal', label: 'Equal', hint: 'Everybody gets the same share of the load.' },
  { key: 'weighted', label: 'Weighted', hint: 'Each evaluator has a percentage of the load (adding up to 100 %), or a maximum number of applications.' },
  { key: 'rules', label: 'By rules', hint: 'The answers send an application to a panel of evaluators, for example “Sector is Health → Health panel”.' },
];

const newId = (): string => {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const numOrNull = (t: string): number | null => { const x = t.replace(/[^\d.]/g, ''); if (x === '' || x === '.') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
const signedOrNull = (t: string): number | null => { const x = t.replace(/[^\d.-]/g, ''); if (x === '' || x === '-' || x === '.') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

type Fields = DistributionView['allocation']['fields'];

export function AllocationEditor({ callId, view, editable, onView }: { callId: string; view: DistributionView; editable: boolean; onView: (v: DistributionView) => void }) {
  const alloc = view.allocation;
  const [cfg, setCfg] = useState<AllocConfig>(() => clone(alloc.config));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<string | null>(null);
  // What the server holds replaces the draft whenever it changes (a save, a reload) — never while somebody is typing.
  useEffect(() => { setCfg(clone(alloc.config)); setDirty(false); setAsk(null); }, [alloc.version, alloc.rev, alloc.config]);
  const people = alloc.people;
  const problems = useMemo(() => (cfg.strategy === 'equal' ? [] : allocProblems(cfg, { evaluators: people.map((p) => ({ userId: p.userId, name: p.name ?? p.email })), fields: alloc.fields.map((f) => ({ id: f.id, kind: f.kind as never, label: f.label, options: f.options })), n: view.evaluatorsPerApplication })), [cfg, people, alloc.fields, view.evaluatorsPerApplication]);
  const set = (next: AllocConfig) => { setCfg(next); setDirty(true); setError(''); };
  const patch = (p: Partial<AllocConfig>) => set({ ...cfg, ...p });

  async function save(confirm = false) {
    setBusy(true); setError('');
    const r = await callsApi.saveAllocation(callId, alloc.rev, cfg, confirm);
    setBusy(false);
    if (!r.ok) {
      if (r.body.code === 'needs_confirm') { setAsk(r.body.error ?? 'Continue?'); return; }
      setError(r.body.error ?? 'The rules could not be saved.');
      if (r.body.code === 'conflict') { const v = await callsApi.distribution(callId); if (v.ok) onView(v.body); }
      return;
    }
    setAsk(null); onView(r.body);
  }

  const showWeighted = cfg.strategy === 'weighted' || (cfg.strategy === 'rules' && cfg.fallback === 'weighted');
  const sum = people.reduce((n, p) => n + (cfg.weighted.percent[p.userId] ?? 0), 0);

  return (
    <div className="min-w-0 space-y-3" data-testid="allocation">
      <fieldset disabled={!editable || busy} className="min-w-0">
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">How the load is shared</legend>
        <div className="mt-1 grid min-w-0 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="How the load is shared">
          {STRATEGIES.map((s) => (
            <label key={s.key} className={`min-w-0 cursor-pointer rounded-lg border p-2.5 text-sm ${cfg.strategy === s.key ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="flex items-center gap-2 font-semibold text-gray-900"><input type="radio" name="alloc-strategy" checked={cfg.strategy === s.key} data-testid={`alloc-${s.key}`} onChange={() => patch({ strategy: s.key })} />{s.label}</span>
              <span className="mt-1 block text-xs text-gray-600">{s.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {alloc.mode === 'versioned' && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="alloc-frozen">{alloc.evaluations.submitted} evaluation{alloc.evaluations.submitted === 1 ? '' : 's'} already submitted: these rules are frozen (version {alloc.version}). A change makes a new version; what was already evaluated stays as it is.</p>}

      {showWeighted && (
        <fieldset disabled={!editable || busy} className="min-w-0 rounded-lg border border-gray-200 p-3" data-testid="alloc-weighted">
          <legend className="px-1 text-sm font-semibold text-gray-900">{cfg.strategy === 'weighted' ? 'The share of each evaluator' : 'The share of each evaluator, for applications that meet no rule'}</legend>
          <div role="radiogroup" aria-label="Percentage or maximum" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-800">
            {(['percent', 'max'] as const).map((b) => <label key={b} className="flex items-center gap-1.5"><input type="radio" name="alloc-by" checked={cfg.weighted.by === b} data-testid={`alloc-by-${b}`} onChange={() => patch({ weighted: { ...cfg.weighted, by: b } })} /> {b === 'percent' ? 'A percentage of the load' : 'A maximum number of applications'}</label>)}
          </div>
          {people.length === 0 && <p className="mt-2 text-xs text-gray-600">Nobody can evaluate yet.</p>}
          <ul className="mt-2 space-y-1.5">
            {people.map((p) => (
              <li key={p.userId} className="flex min-w-0 items-center justify-between gap-3" data-testid="alloc-person">
                <span className="min-w-0 text-sm text-gray-800 [overflow-wrap:anywhere]">{p.name ?? p.email ?? 'Evaluator'}</span>
                {cfg.weighted.by === 'percent'
                  ? <label className="flex shrink-0 items-center gap-1 text-sm text-gray-700"><input inputMode="decimal" autoComplete="off" aria-label={`Percentage for ${p.name ?? p.email}`} className={`${INPUT} !w-20 text-right`} value={cfg.weighted.percent[p.userId] ?? ''} data-testid={`alloc-pct-${p.userId}`} onChange={(e) => patch({ weighted: { ...cfg.weighted, percent: { ...cfg.weighted.percent, [p.userId]: numOrNull(e.target.value) } } })} /> %</label>
                  : <label className="flex shrink-0 items-center gap-1 text-sm text-gray-700"><span className="text-xs text-gray-500">at most</span><input inputMode="numeric" autoComplete="off" aria-label={`Maximum for ${p.name ?? p.email}`} className={`${INPUT} !w-20 text-right`} value={cfg.weighted.max[p.userId] ?? ''} data-testid={`alloc-max-${p.userId}`} onChange={(e) => { const n = numOrNull(e.target.value); patch({ weighted: { ...cfg.weighted, max: { ...cfg.weighted.max, [p.userId]: n === null ? null : Math.floor(n) } } }); }} /></label>}
              </li>
            ))}
          </ul>
          {cfg.weighted.by === 'percent' && people.length > 0 && <p className={`mt-2 text-sm font-semibold ${Math.abs(sum - 100) < 0.001 ? 'text-emerald-900' : 'text-amber-950'}`} aria-live="polite" data-testid="alloc-sum">{Math.abs(sum - 100) < 0.001 ? 'Sum of the percentages: 100 % ✓' : `⚠ Sum of the percentages: ${Math.round(sum * 1000) / 1000} % — ${Math.round(Math.abs(100 - sum) * 1000) / 1000} % ${sum < 100 ? 'missing' : 'over'}`}</p>}
          <p className="mt-1 text-[11px] text-gray-500">The number of evaluators per application and the conflicts of interest still hold. The preview shows the number each person would really get.</p>
        </fieldset>
      )}

      {cfg.strategy === 'rules' && <RulesEditor cfg={cfg} set={set} fields={alloc.fields} people={people} n={view.evaluatorsPerApplication} disabled={!editable || busy} />}

      {cfg.strategy !== 'equal' && problems.length > 0 && (
        <ul className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950" role="status" data-testid="alloc-problems">
          {problems.map((p) => <li key={p}>⚠ {p}</li>)}
          <li className="mt-1 text-amber-900">The rules are saved as you build them, but nothing can be applied until this is fixed.</li>
        </ul>
      )}
      {ask && (
        <div className="rounded-lg border border-[#0E7490] bg-white p-3" role="group" aria-label="Confirm the change" data-testid="alloc-confirm">
          <p className="text-sm text-gray-800">{ask}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} data-testid="alloc-confirm-yes" onClick={() => void save(true)}>{busy ? 'Saving…' : 'Yes, make the new version'}</button>
            <button type="button" className={BTN} disabled={busy} data-testid="alloc-confirm-no" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded bg-red-50 px-2 py-1.5 text-xs text-[#B00000]" data-testid="alloc-error">{error}</p>}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY} disabled={busy || !dirty} data-testid="alloc-save" onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save how the load is shared'}</button>
          {dirty && <span className="text-xs text-amber-900" data-testid="alloc-dirty">Not saved yet</span>}
        </div>
      )}
    </div>
  );
}

function RulesEditor({ cfg, set, fields, people, n, disabled }: {
  cfg: AllocConfig; set: (c: AllocConfig) => void; fields: Fields; people: DistributionView['allocation']['people']; n: number | 'all'; disabled: boolean;
}) {
  const setPanel = (id: string, p: Partial<Panel>) => set({ ...cfg, panels: cfg.panels.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const setRule = (id: string, p: Partial<Rule>) => set({ ...cfg, rules: cfg.rules.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const move = (i: number, dir: -1 | 1) => { const r = [...cfg.rules]; const j = i + dir; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; set({ ...cfg, rules: r }); };
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <div className="min-w-0 space-y-4" data-testid="alloc-rules">
      <fieldset disabled={disabled} className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold text-gray-900">Panels of evaluators</legend>
        <p className="text-xs text-gray-600">A panel is a named group of evaluators, like “Health panel”. A person can be in several.</p>
        {cfg.panels.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-3 text-center text-sm text-gray-500" data-testid="alloc-no-panels">No panel yet.</p>}
        {cfg.panels.map((p, i) => {
          const live = p.members.filter((m) => people.some((x) => x.userId === m));
          const need = n === 'all' ? live.length : n;
          const psum = live.reduce((t, m) => t + (p.percent[m] ?? 0), 0);
          return (
            <article key={p.id} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="alloc-panel">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Panel {i + 1}</span>
                <button type="button" aria-label={`Remove ${p.name || 'this panel'}`} className="rounded px-2 py-1 text-gray-400 hover:text-[#B00000]" data-testid="alloc-panel-remove" onClick={() => setRemoving(p.id)}>✕</button>
              </div>
              {removing === p.id && (
                <div className="mb-2 rounded border border-[#B00000] p-2" role="group" aria-label="Confirm removing the panel" data-testid="alloc-panel-remove-confirm">
                  <p className="text-xs text-gray-800">Remove “{p.name || 'this panel'}”{cfg.rules.some((r) => r.panelId === p.id) ? ' (the rules that send applications to it will need another panel)' : ''}?</p>
                  <div className="mt-1.5 flex gap-2"><button type="button" className="min-h-[44px] rounded-lg bg-[#B00000] px-3 py-1 text-sm font-semibold text-white sm:min-h-0 sm:text-xs" data-testid="alloc-panel-remove-yes" onClick={() => { set({ ...cfg, panels: cfg.panels.filter((x) => x.id !== p.id), rules: cfg.rules.map((r) => (r.panelId === p.id ? { ...r, panelId: '' } : r)) }); setRemoving(null); }}>Yes, remove it</button><button type="button" className={BTN} onClick={() => setRemoving(null)}>Keep</button></div>
                </div>
              )}
              <label className={LABEL} htmlFor={`pn-${p.id}`}>Name</label>
              <input id={`pn-${p.id}`} autoComplete="off" className={INPUT} maxLength={60} value={p.name} placeholder="e.g. Health panel" data-testid="alloc-panel-name" onChange={(e) => setPanel(p.id, { name: e.target.value })} />
              <p className={`${LABEL} mt-2`}>Evaluators</p>
              <ul className="mt-1 grid min-w-0 gap-1 sm:grid-cols-2">
                {people.map((x) => (
                  <li key={x.userId} className="flex min-w-0 items-center justify-between gap-2">
                    <label className="flex min-h-[44px] min-w-0 items-center gap-2 text-sm text-gray-800 sm:min-h-0"><input type="checkbox" checked={p.members.includes(x.userId)} data-testid={`alloc-member-${p.id}-${x.userId}`} onChange={(e) => setPanel(p.id, { members: e.target.checked ? [...p.members, x.userId] : p.members.filter((m) => m !== x.userId) })} /><span className="min-w-0 [overflow-wrap:anywhere]">{x.name ?? x.email ?? 'Evaluator'}</span></label>
                    {p.balance === 'percent' && p.members.includes(x.userId) && <label className="flex shrink-0 items-center gap-1 text-sm text-gray-700"><input inputMode="decimal" autoComplete="off" aria-label={`Percentage for ${x.name ?? x.email} in ${p.name || 'this panel'}`} className={`${INPUT} !w-16 text-right`} value={p.percent[x.userId] ?? ''} data-testid={`alloc-panel-pct-${p.id}-${x.userId}`} onChange={(e) => setPanel(p.id, { percent: { ...p.percent, [x.userId]: numOrNull(e.target.value) } })} /> %</label>}
                  </li>
                ))}
              </ul>
              <div role="radiogroup" aria-label="How the load is shared inside the panel" className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-800">
                {(['equal', 'percent'] as const).map((b) => <label key={b} className="flex items-center gap-1.5"><input type="radio" name={`pb-${p.id}`} checked={p.balance === b} data-testid={`alloc-panel-${b}-${p.id}`} onChange={() => setPanel(p.id, { balance: b })} /> {b === 'equal' ? 'Equal load inside the panel' : 'A percentage each'}</label>)}
              </div>
              {p.balance === 'percent' && live.length > 0 && <p className={`mt-1 text-xs font-semibold ${Math.abs(psum - 100) < 0.001 ? 'text-emerald-900' : 'text-amber-950'}`}>{Math.abs(psum - 100) < 0.001 ? 'Sum: 100 % ✓' : `⚠ Sum: ${Math.round(psum * 1000) / 1000} %, not 100 %`}</p>}
              {live.length > 0 && live.length < need && (
                <div className="mt-2 rounded bg-amber-50 px-2.5 py-2" data-testid="alloc-panel-short">
                  <p className="text-xs text-amber-950">⚠ This panel has {live.length} evaluator{live.length === 1 ? '' : 's'} but each application needs {need}. Choose what to do:</p>
                  <select aria-label={`What to do when ${p.name || 'this panel'} is smaller than the number of evaluators`} className={`${INPUT} mt-1`} value={p.shortfall ?? ''} data-testid={`alloc-shortfall-${p.id}`} onChange={(e) => setPanel(p.id, { shortfall: e.target.value === 'complete' || e.target.value === 'lower' ? e.target.value : null })}>
                    <option value="">Choose…</option><option value="complete">Complete with evaluators from outside the panel</option><option value="lower">Lower the number for this panel (use only its people)</option>
                  </select>
                </div>
              )}
            </article>
          );
        })}
        <button type="button" className={BTN} data-testid="alloc-add-panel" onClick={() => set({ ...cfg, panels: [...cfg.panels, { id: newId(), name: '', members: [], balance: 'equal', percent: {}, shortfall: null }] })}>+ Add a panel</button>
      </fieldset>

      <fieldset disabled={disabled} className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold text-gray-900">Rules, in order</legend>
        <p className="text-xs text-gray-600">Each rule sends the applications that meet ALL its conditions to a panel. Rules use closed questions: single choice, multiple choice (contains), Yes/No, number or amount (a range).</p>
        {cfg.rules.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-3 text-center text-sm text-gray-500" data-testid="alloc-no-rules">No rule yet.</p>}
        {cfg.rules.map((r, i) => (
          <article key={r.id} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="alloc-rule">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Rule {i + 1}</span>
              <span className="flex shrink-0 items-center">
                <button type="button" aria-label="Move up" disabled={i === 0} className="rounded px-2 py-1 text-gray-500 hover:text-[#0E7490] disabled:opacity-30" onClick={() => move(i, -1)}>↑</button>
                <button type="button" aria-label="Move down" disabled={i === cfg.rules.length - 1} className="rounded px-2 py-1 text-gray-500 hover:text-[#0E7490] disabled:opacity-30" onClick={() => move(i, 1)}>↓</button>
                <button type="button" aria-label="Remove rule" className="rounded px-2 py-1 text-gray-400 hover:text-[#B00000]" data-testid="alloc-rule-remove" onClick={() => set({ ...cfg, rules: cfg.rules.filter((x) => x.id !== r.id) })}>✕</button>
              </span>
            </div>
            <ul className="space-y-2">
              {r.conditions.map((c, ci) => (
                <ConditionEditor key={ci} c={c} fields={fields} first={ci === 0} disabled={disabled}
                  onChange={(next) => setRule(r.id, { conditions: r.conditions.map((x, j) => (j === ci ? next : x)) })} onRemove={() => setRule(r.id, { conditions: r.conditions.filter((_, j) => j !== ci) })} />
              ))}
            </ul>
            <button type="button" className={`${BTN} mt-2`} data-testid="alloc-add-condition" disabled={fields.length === 0} onClick={() => setRule(r.id, { conditions: [...r.conditions, blankCondition(fields[0])] })}>+ Add a condition (and)</button>
            <label className={`${LABEL} mt-2`} htmlFor={`rp-${r.id}`}>Send to the panel</label>
            <select id={`rp-${r.id}`} className={INPUT} value={r.panelId} data-testid="alloc-rule-panel" onChange={(e) => setRule(r.id, { panelId: e.target.value })}>
              <option value="">Choose a panel…</option>{cfg.panels.map((p) => <option key={p.id} value={p.id}>{p.name || 'Unnamed panel'}</option>)}
            </select>
          </article>
        ))}
        <button type="button" className={BTN} data-testid="alloc-add-rule" disabled={fields.length === 0 || cfg.panels.length === 0} onClick={() => set({ ...cfg, rules: [...cfg.rules, { id: newId(), panelId: cfg.panels[0]?.id ?? '', conditions: [blankCondition(fields[0])] }] })}>+ Add a rule</button>
        {fields.length === 0 && <p className="text-xs text-gray-500">The form has no closed question yet, so there is nothing for a rule to look at.</p>}
      </fieldset>

      <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-sm font-semibold text-gray-900">When an application meets…</legend>
        <div role="radiogroup" aria-label="An application that meets several rules" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-800">
          <span className="basis-full text-xs text-gray-600">…several rules</span>
          {([['first', 'The first matching rule (its panel only)'], ['all', 'All the matching panels']] as const).map(([k, t]) => <label key={k} className="flex items-center gap-1.5"><input type="radio" name="alloc-multi" checked={cfg.multi === k} data-testid={`alloc-multi-${k}`} onChange={() => set({ ...cfg, multi: k })} /> {t}</label>)}
        </div>
        <div role="radiogroup" aria-label="An application that meets no rule" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-800">
          <span className="basis-full text-xs text-gray-600">…no rule</span>
          {([['equal', 'Share it equally among all evaluators'], ['weighted', 'Share it among all evaluators by their percentages'], ['unassigned', 'Leave it “Unassigned”, to assign by hand']] as const).map(([k, t]) => <label key={k} className="flex items-center gap-1.5"><input type="radio" name="alloc-fallback" checked={cfg.fallback === k} data-testid={`alloc-fallback-${k}`} onChange={() => set({ ...cfg, fallback: k })} /> {t}</label>)}
        </div>
        <p className="text-[11px] text-gray-500">The number of evaluators per application counts inside each panel.</p>
      </fieldset>
    </div>
  );
}

function blankCondition(f: Fields[number] | undefined): Condition {
  if (!f) return { fieldId: '', type: 'yes_no', yes: true };
  if (f.kind === 'yes_no') return { fieldId: f.id, type: 'yes_no', yes: true };
  if (f.kind === 'number') return { fieldId: f.id, type: 'range', min: null, max: null };
  return { fieldId: f.id, type: 'choice', optionIds: [] };
}

function ConditionEditor({ c, fields, first, disabled, onChange, onRemove }: { c: Condition; fields: Fields; first: boolean; disabled: boolean; onChange: (c: Condition) => void; onRemove: () => void }) {
  const f = fields.find((x) => x.id === c.fieldId);
  return (
    <li className="min-w-0 rounded bg-gray-50 p-2" data-testid="alloc-condition">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-8 shrink-0 text-xs font-semibold text-gray-500">{first ? 'If' : 'and'}</span>
        <select aria-label="Question" className={INPUT} disabled={disabled} value={c.fieldId} data-testid="alloc-condition-field" onChange={(e) => onChange(blankCondition(fields.find((x) => x.id === e.target.value)))}>
          {!f && <option value={c.fieldId}>A question that was removed</option>}
          {fields.map((x) => <option key={x.id} value={x.id}>{x.number}. {x.label}</option>)}
        </select>
        <button type="button" aria-label="Remove condition" className="shrink-0 rounded px-2 py-1 text-gray-400 hover:text-[#B00000]" disabled={disabled} onClick={onRemove}>✕</button>
      </div>
      {f && c.type === 'choice' && (
        <fieldset className="mt-1.5 grid min-w-0 gap-1 sm:grid-cols-2" disabled={disabled}>
          <legend className="text-[11px] text-gray-500">{f.kind === 'multiple_choice' ? 'contains any of' : 'is any of'}</legend>
          {f.options.map((o) => (
            <label key={o.id} className="flex min-h-[44px] min-w-0 items-center gap-2 text-sm text-gray-800 sm:min-h-0"><input type="checkbox" checked={c.optionIds.includes(o.id)} data-testid={`alloc-option-${o.id}`} onChange={(e) => onChange({ ...c, optionIds: e.target.checked ? [...c.optionIds, o.id] : c.optionIds.filter((x) => x !== o.id) })} /><span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span></label>
          ))}
        </fieldset>
      )}
      {f && c.type === 'yes_no' && (
        <select aria-label="Answer" className={`${INPUT} mt-1.5`} disabled={disabled} value={c.yes ? 'yes' : 'no'} data-testid="alloc-condition-yes" onChange={(e) => onChange({ ...c, yes: e.target.value === 'yes' })}><option value="yes">is Yes</option><option value="no">is No</option></select>
      )}
      {f && c.type === 'range' && (
        <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <label className="min-w-0 text-xs text-gray-600">from (minimum)<input inputMode="decimal" autoComplete="off" className={INPUT} disabled={disabled} value={c.min ?? ''} data-testid="alloc-range-min" onChange={(e) => onChange({ ...c, min: signedOrNull(e.target.value) })} /></label>
          <label className="min-w-0 text-xs text-gray-600">up to (maximum)<input inputMode="decimal" autoComplete="off" className={INPUT} disabled={disabled} value={c.max ?? ''} data-testid="alloc-range-max" onChange={(e) => onChange({ ...c, max: signedOrNull(e.target.value) })} /></label>
        </div>
      )}
    </li>
  );
}

