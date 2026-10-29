'use client';
// Prompt 918 (I2) — Setup → "Eligibility rules". Each rule is tied to a question or a document of the form and is shown as one sentence with its boundary ("Applicants who state exactly 500 000 € are
// eligible."). What the import found appears as "Suggested rules" (nothing becomes a rule without a click). A document rule shows "How we check this document", read only: the platform prepared it from
// the text the entity wrote and nobody has to confirm it. An open requirement offers a closed question instead. The rules are frozen once the call has opened: a change then makes a new version and asks,
// in the page, for a confirmation that says how many applications are evaluated again. Nothing here is a browser dialog.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RULE_KIND_LABELS, ruleSentence, type EligibilityRule, type RuleKind } from '@/lib/calls/eligibility';
import type { EligibilityView, QuestionOption, RuleView } from '@/lib/calls/eligibility-view';
import type { Call } from '@/lib/calls/types';
import { callsApi, type CallState } from './api';
import { AutoTextarea } from './AutoTextarea';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';

type Draft = { id: string | null; fieldId: string; kind: RuleKind | ''; params: Record<string, unknown>; note: string };
const blank = (note = ''): Draft => ({ id: null, fieldId: '', kind: '', params: {}, note });

const asRuleBody = (r: { id: string | null; fieldId: string; kind: string; params: unknown; note: string | null }) => ({ id: r.id ?? undefined, fieldId: r.fieldId, kind: r.kind, params: r.params, note: r.note });

/** The default parameters when a kind is chosen, so the form never shows an empty state that cannot be saved by accident. */
function defaultParams(kind: RuleKind, q: QuestionOption | undefined): Record<string, unknown> {
  switch (kind) {
    case 'options': return { accepted: [], mode: 'any' };
    case 'number': return { op: 'lte', value: '' };
    case 'date': return { op: 'within_last', amount: 5, unit: 'years', reference: 'call_opens' };
    case 'yes_no': return { expected: 'yes' };
    case 'doc_right': return { docType: null };
    case 'doc_valid': return { maxAgeMonths: null, matchName: null, matchTaxId: null };
    case 'open': return { text: '' };
    default: void q; return {};
  }
}

export function EligibilityStep({ callId, call, disabled, canManage, onRulesChanged, onState }: {
  callId: string; call: Pick<Call, 'currency' | 'opensAt' | 'closesAt' | 'timezone'>; disabled: boolean; canManage: boolean;
  /** The number of rules changed: the editor refreshes the step's state and "What is missing". */
  onRulesChanged: (count: number) => void;
  /** A change that also touched the form (a closed question was added): the whole call as it is now. */
  onState: (s: CallState) => void;
}) {
  const [view, setView] = useState<EligibilityView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [ask, setAsk] = useState<{ text: string; rules: unknown[] } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // The callback is a new function on every render of the editor: loading must not depend on its identity (see EvalGridStep — it made the step reload endlessly and drop what was being typed).
  const countRef = useRef(onRulesChanged);
  countRef.current = onRulesChanged;
  const load = useCallback(async () => {
    const r = await callsApi.eligibility(callId);
    if (!r.ok) { setError(r.body.error ?? 'Could not load the rules.'); return; }
    setError(''); setView(r.body); countRef.current(r.body.rules.length);
  }, [callId]);
  useEffect(() => { void load(); }, [load]);

  const editable = !disabled && canManage && !!view && (view.mode === 'edit' || view.mode === 'versioned');
  const questions = view?.questions ?? [];
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);

  /** Sends the whole list of rules (what is shown, with the change made) and shows the server's answer. */
  async function save(rules: unknown[], confirm = false): Promise<boolean> {
    if (!view) return false;
    setBusy(true); setError(''); setFormError('');
    const r = await callsApi.saveEligibility(callId, view.rev, rules, confirm);
    setBusy(false);
    if (!r.ok) {
      if (r.body.code === 'needs_confirm') { setAsk({ text: r.body.error ?? 'Continue?', rules }); return false; }
      if (r.body.code === 'conflict') { setError(r.body.error ?? 'Someone else changed the rules.'); void load(); return false; }
      setFormError(r.body.error ?? 'The rules could not be saved.'); return false;
    }
    setAsk(null); setView(r.body); onRulesChanged(r.body.rules.length);
    return true;
  }

  const currentBodies = () => (view?.rules ?? []).map((r) => asRuleBody({ id: r.id, fieldId: r.fieldId, kind: r.kind, params: r.params, note: r.note }));

  async function saveDraft() {
    if (!draft || !view) return;
    if (!draft.fieldId) { setFormError('Choose the question or document this rule is about.'); return; }
    if (!draft.kind) { setFormError('Choose the kind of rule.'); return; }
    const body = asRuleBody({ id: draft.id, fieldId: draft.fieldId, kind: draft.kind, params: draft.params, note: draft.note.trim() || null });
    const list = currentBodies();
    const next = draft.id ? list.map((r) => (r.id === draft.id ? body : r)) : [...list, body];
    if (await save(next)) setDraft(null);
  }

  async function remove(id: string) {
    setRemoving(null);
    await save(currentBodies().filter((r) => r.id !== id));
  }

  async function dismiss(text: string) {
    await callsApi.dismissSuggestion(callId, text);
    void load();
  }

  async function closeQuestion(ruleId: string) {
    setBusy(true); setError('');
    const r = await callsApi.closeOpenRule(callId, ruleId);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'Could not add the question.'); return; }
    onState(r.body);
    void load();
  }

  if (!view) return <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500" data-testid="eligibility-loading">{error || 'Loading the rules…'}</div>;

  const sentenceOf = (d: Draft): string | null => {
    if (!d.fieldId || !d.kind) return null;
    const q = byId.get(d.fieldId);
    const rule: EligibilityRule = { id: 'draft', fieldId: d.fieldId, kind: d.kind, params: d.params as never, note: d.note || null, position: 0 };
    try { return ruleSentence(rule, q ? { label: q.label, options: q.options, kind: q.kind } : undefined, { currency: call.currency, call, docTypeLabel: (k) => view.docTypes.find((t) => t.key === k)?.label ?? null }); } catch { return null; }
  };

  return (
    <div className="min-w-0 space-y-4" data-testid="eligibility-step">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Who can apply</h3>
        <p className="mt-1 text-xs text-gray-600">Each rule is about one question or document of your form. An application is a “Fit” only if it meets every rule. Clear failures are “Not a fit”; whatever the platform cannot be sure of goes to “To validate”, for a person to decide. Nothing here excludes anyone without a clear, objective reason.</p>
        {view.mode === 'locked' && <p className="mt-2 rounded bg-sky-50 px-2 py-1.5 text-xs text-sky-900" data-testid="eligibility-locked">The rules are locked while the call is confirmed. Use “Edit configuration” in Review &amp; publish to change them before it opens.</p>}
        {view.mode === 'versioned' && <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="eligibility-frozen">The call has opened, so these rules are frozen (version {view.version}). A change makes a new version and evaluates the {view.submitted} submitted application{view.submitted === 1 ? '' : 's'} again; the earlier results stay on record.</p>}
        {view.mode === 'archived' && <p className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">An archived call cannot be changed.</p>}
        {error && <p role="alert" className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-[#B00000]" data-testid="eligibility-error">{error}</p>}
      </section>

      {view.suggestions.length > 0 && (
        <section className="rounded-lg border border-[#BAD9E3] bg-[#E8F4F8] p-4" data-testid="eligibility-suggestions">
          <h3 className="text-sm font-semibold text-[#0E7490]">Suggested rules</h3>
          <p className="mt-0.5 text-xs text-gray-700">The import found these requirements in your documents. Nothing becomes a rule until you create it.</p>
          <ul className="mt-2 space-y-2">
            {view.suggestions.map((t) => (
              <li key={t} className="min-w-0 rounded-lg bg-white p-2.5" data-testid="suggestion">
                <p className="text-sm text-gray-800 [overflow-wrap:anywhere]">{t}</p>
                {editable && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={BTN} data-testid="suggestion-use" onClick={() => { setDraft(blank(t)); setFormError(''); }}>Create a rule from this</button>
                    <button type="button" className={BTN} data-testid="suggestion-dismiss" onClick={() => void dismiss(t)}>Discard</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2" aria-label="Rules">
        {view.rules.length === 0 && !draft && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500" data-testid="no-rules">No rules yet: every submitted application will be a Fit. Add a rule to limit who can apply.</p>}
        {view.rules.map((r) => (
          <RuleCard key={r.id} rule={r} editable={editable} busy={busy} removing={removing === r.id} canClose={view.mode === 'edit' && r.kind === 'open'}
            onEdit={() => { setDraft({ id: r.id, fieldId: r.fieldId, kind: r.kind, params: { ...(r.params as Record<string, unknown>) }, note: r.note ?? '' }); setFormError(''); }}
            onAskRemove={() => setRemoving(r.id)} onKeep={() => setRemoving(null)} onRemove={() => void remove(r.id)} onClose={() => void closeQuestion(r.id)} />
        ))}
      </section>

      {ask && (
        <div className="rounded-lg border border-[#0E7490] bg-white p-3" role="group" aria-label="Confirm the change" data-testid="eligibility-confirm">
          <p className="text-sm text-gray-800">{ask.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={PRIMARY} data-testid="eligibility-confirm-yes" onClick={() => void save(ask.rules, true).then((ok) => { if (ok) setDraft(null); })}>{busy ? 'Saving…' : 'Yes, make the new version'}</button>
            <button type="button" disabled={busy} className={BTN} data-testid="eligibility-confirm-no" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </div>
      )}

      {draft ? (
        <RuleForm draft={draft} questions={questions} view={view} sentence={sentenceOf(draft)} busy={busy} error={formError} onChange={setDraft} onSave={() => void saveDraft()} onCancel={() => { setDraft(null); setFormError(''); }} />
      ) : editable && (
        <button type="button" className={PRIMARY} data-testid="add-rule" onClick={() => { setDraft(blank()); setFormError(''); }} disabled={busy || questions.length === 0}>+ Add a rule</button>
      )}
      {editable && questions.length === 0 && <p className="text-xs text-gray-500">Add questions to the form first: each rule is about one of them.</p>}
      {formError && !draft && <p role="alert" className="text-xs text-[#B00000]">{formError}</p>}
    </div>
  );
}

function RuleCard({ rule, editable, busy, removing, canClose, onEdit, onAskRemove, onKeep, onRemove, onClose }: {
  rule: RuleView; editable: boolean; busy: boolean; removing: boolean; canClose: boolean; onEdit: () => void; onAskRemove: () => void; onKeep: () => void; onRemove: () => void; onClose: () => void;
}) {
  return (
    <article className={`min-w-0 rounded-lg border bg-white p-3 ${rule.problems.length > 0 ? 'border-[#B00000]' : 'border-gray-200'}`} data-testid="rule-card">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 [overflow-wrap:anywhere]">{rule.kindLabel} · {rule.fieldLabel}</p>
      <p className="mt-1 text-sm text-gray-900 [overflow-wrap:anywhere]" data-testid="rule-sentence">{rule.sentence}</p>
      {rule.problems.map((p) => <p key={p} role="alert" className="mt-1 text-xs text-[#B00000]" data-testid="rule-problem">⚠ {p}</p>)}
      {rule.recipe && rule.recipe.length > 0 && (
        <details className="mt-2 rounded bg-gray-50 px-2.5 py-1.5" data-testid="rule-recipe">
          <summary className="cursor-pointer text-xs font-medium text-[#0E7490]">How we check this document</summary>
          <ul className="mt-1.5 space-y-1 text-xs text-gray-700">{rule.recipe.map((l) => <li key={l} className="[overflow-wrap:anywhere]">{l}</li>)}</ul>
          <p className="mt-1.5 text-[11px] text-gray-400">Prepared by the platform from the text you wrote. Nobody has to confirm it.</p>
        </details>
      )}
      {editable && (
        removing ? (
          <div className="mt-2 rounded border border-[#B00000] p-2" role="group" aria-label="Confirm removing the rule" data-testid="rule-remove-confirm">
            <p className="text-xs text-gray-800">Remove this rule?</p>
            <div className="mt-1.5 flex gap-2">
              <button type="button" className="min-h-[44px] rounded-lg bg-[#B00000] px-3 py-1 text-sm font-semibold text-white sm:min-h-0 sm:text-xs" disabled={busy} data-testid="rule-remove-yes" onClick={onRemove}>Yes, remove it</button>
              <button type="button" className={BTN} data-testid="rule-remove-no" onClick={onKeep}>Keep</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={BTN} disabled={busy} data-testid="rule-edit" onClick={onEdit}>Edit</button>
            <button type="button" className={`${BTN} text-[#B00000]`} disabled={busy} data-testid="rule-remove" onClick={onAskRemove}>Remove</button>
            {canClose && <button type="button" className={BTN} disabled={busy} data-testid="rule-close-question" onClick={onClose}>Turn into a closed question</button>}
          </div>
        )
      )}
    </article>
  );
}

function RuleForm({ draft, questions, view, sentence, busy, error, onChange, onSave, onCancel }: {
  draft: Draft; questions: QuestionOption[]; view: EligibilityView; sentence: string | null; busy: boolean; error: string; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void;
}) {
  const q = questions.find((x) => x.id === draft.fieldId);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const setParams = (patch: Record<string, unknown>) => onChange({ ...draft, params: { ...draft.params, ...patch } });
  const textQuestions = questions.filter((x) => x.kind === 'short_text');
  const p = draft.params;
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-[#0E7490] bg-white p-3" aria-label={draft.id ? 'Edit the rule' : 'New rule'} data-testid="rule-form">
      <h3 className="text-sm font-semibold text-gray-900">{draft.id ? 'Edit the rule' : 'New rule'}</h3>
      {draft.note && !draft.id && <p className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-600 [overflow-wrap:anywhere]">From your documents: “{draft.note}”</p>}
      <div>
        <label className={LABEL} htmlFor="rule-question">Question or document</label>
        <select id="rule-question" className={INPUT} value={draft.fieldId} data-testid="rule-question"
          onChange={(e) => { const nq = questions.find((x) => x.id === e.target.value); const kind = nq && draft.kind && nq.allowed.includes(draft.kind) ? draft.kind : ''; set({ fieldId: e.target.value, kind, params: kind ? draft.params : {} }); }}>
          <option value="">Choose…</option>
          {questions.map((x) => <option key={x.id} value={x.id}>{x.label.length > 70 ? `${x.label.slice(0, 70)}…` : x.label} (page {x.page})</option>)}
        </select>
      </div>
      {q && (
        <div>
          <label className={LABEL} htmlFor="rule-kind">Kind of rule</label>
          <select id="rule-kind" className={INPUT} value={draft.kind} data-testid="rule-kind" onChange={(e) => { const kind = e.target.value as RuleKind | ''; set({ kind, params: kind ? defaultParams(kind, q) : {} }); }}>
            <option value="">Choose…</option>
            {q.allowed.map((k) => <option key={k} value={k}>{RULE_KIND_LABELS[k]}</option>)}
          </select>
        </div>
      )}

      {q && draft.kind === 'options' && (
        <fieldset className="min-w-0" data-testid="params-options">
          <legend className={LABEL}>Accepted options</legend>
          <ul className="mt-1 space-y-1">
            {q.options.map((o) => {
              const accepted = (p.accepted as string[] | undefined) ?? [];
              return (
                <li key={o.id}><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={accepted.includes(o.id)}
                  onChange={(e) => setParams({ accepted: e.target.checked ? [...accepted, o.id] : accepted.filter((x) => x !== o.id) })} /><span className="[overflow-wrap:anywhere]">{o.label}</span></label></li>
              );
            })}
          </ul>
          {q.kind === 'multiple_choice' && (
            <div className="mt-2"><label className={LABEL} htmlFor="rule-mode">When several are chosen</label>
              <select id="rule-mode" className={INPUT} value={String(p.mode ?? 'any')} onChange={(e) => setParams({ mode: e.target.value })}>
                <option value="any">At least one chosen option is accepted</option><option value="only">Every chosen option is accepted</option>
              </select></div>
          )}
        </fieldset>
      )}

      {q && draft.kind === 'number' && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2" data-testid="params-number">
          <div className="col-span-2"><label className={LABEL} htmlFor="rule-op">Comparison</label>
            <select id="rule-op" className={INPUT} value={String(p.op ?? 'lte')} onChange={(e) => setParams({ op: e.target.value })}>
              <option value="lte">At most (≤)</option><option value="lt">Less than (&lt;)</option><option value="gte">At least (≥)</option><option value="gt">More than (&gt;)</option><option value="eq">Exactly</option><option value="between">Between (both included)</option>
            </select></div>
          <div className={p.op === 'between' ? '' : 'col-span-2'}><label className={LABEL} htmlFor="rule-value">{p.op === 'between' ? 'From' : 'Value'}</label>
            <input id="rule-value" inputMode="numeric" autoComplete="off" className={INPUT} placeholder="Digits only" value={String(p.value ?? '')} onChange={(e) => setParams({ value: e.target.value.replace(/\D/g, '').slice(0, 15) })} /></div>
          {p.op === 'between' && <div><label className={LABEL} htmlFor="rule-value2">To</label>
            <input id="rule-value2" inputMode="numeric" autoComplete="off" className={INPUT} placeholder="Digits only" value={String(p.value2 ?? '')} onChange={(e) => setParams({ value2: e.target.value.replace(/\D/g, '').slice(0, 15) })} /></div>}
        </div>
      )}

      {q && draft.kind === 'date' && (
        <div className="space-y-2" data-testid="params-date">
          <div><label className={LABEL} htmlFor="rule-dop">Comparison</label>
            <select id="rule-dop" className={INPUT} value={String(p.op ?? 'within_last')} onChange={(e) => setParams({ op: e.target.value })}>
              <option value="within_last">No older than… (counted back from a day)</option><option value="on_or_after">On or after a date</option><option value="on_or_before">On or before a date</option>
            </select></div>
          {p.op === 'within_last' ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <div><label className={LABEL} htmlFor="rule-amount">How long</label><input id="rule-amount" inputMode="numeric" autoComplete="off" className={INPUT} value={String(p.amount ?? '')} onChange={(e) => setParams({ amount: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></div>
                <div><label className={LABEL} htmlFor="rule-unit">Unit</label><select id="rule-unit" className={INPUT} value={String(p.unit ?? 'years')} onChange={(e) => setParams({ unit: e.target.value })}><option value="years">years</option><option value="months">months</option></select></div>
              </div>
              <div><label className={LABEL} htmlFor="rule-ref">Counted back from</label>
                <select id="rule-ref" className={INPUT} value={String(p.reference ?? 'call_opens')} onChange={(e) => setParams({ reference: e.target.value })}>
                  <option value="call_opens">The day the call opens</option><option value="call_closes">The day the call closes</option><option value="fixed">A day I choose</option>
                </select></div>
              {p.reference === 'fixed' && <div><label className={LABEL} htmlFor="rule-refdate">Reference day</label><input id="rule-refdate" type="date" className={INPUT} value={String(p.referenceDate ?? '')} onChange={(e) => setParams({ referenceDate: e.target.value })} /></div>}
            </>
          ) : (
            <div><label className={LABEL} htmlFor="rule-date">Date</label><input id="rule-date" type="date" className={INPUT} value={String(p.date ?? '')} onChange={(e) => setParams({ date: e.target.value })} /></div>
          )}
        </div>
      )}

      {q && draft.kind === 'yes_no' && (
        <fieldset data-testid="params-yesno"><legend className={LABEL}>Which answer is eligible</legend>
          <div className="mt-1 flex gap-4 text-sm">
            {(['yes', 'no'] as const).map((v) => <label key={v} className="flex items-center gap-1.5"><input type="radio" name="rule-expected" checked={p.expected === v} onChange={() => setParams({ expected: v })} /> {v === 'yes' ? 'Yes' : 'No'}</label>)}
          </div>
        </fieldset>
      )}

      {q && draft.kind === 'doc_right' && (
        <div data-testid="params-docright"><label className={LABEL} htmlFor="rule-doctype">Kind of document</label>
          <select id="rule-doctype" className={INPUT} value={String(p.docType ?? '')} onChange={(e) => setParams({ docType: e.target.value || null })}>
            <option value="">Work it out from what I wrote</option>
            {view.docTypes.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select></div>
      )}

      {q && draft.kind === 'doc_valid' && (
        <div className="space-y-2" data-testid="params-docvalid">
          <div><label className={LABEL} htmlFor="rule-age">Issued within the last (months, optional)</label>
            <input id="rule-age" inputMode="numeric" autoComplete="off" className={INPUT} value={p.maxAgeMonths == null ? '' : String(p.maxAgeMonths)} onChange={(e) => setParams({ maxAgeMonths: e.target.value ? Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || null : null })} /></div>
          <div><label className={LABEL} htmlFor="rule-name">Company name must match the answer to</label>
            <select id="rule-name" className={INPUT} value={String(p.matchName ?? '')} onChange={(e) => setParams({ matchName: e.target.value || null })}><option value="">— nothing —</option>{textQuestions.map((x) => <option key={x.id} value={x.id}>{x.label.slice(0, 70)}</option>)}</select></div>
          <div><label className={LABEL} htmlFor="rule-tax">Tax ID must match the answer to</label>
            <select id="rule-tax" className={INPUT} value={String(p.matchTaxId ?? '')} onChange={(e) => setParams({ matchTaxId: e.target.value || null })}><option value="">— nothing —</option>{textQuestions.map((x) => <option key={x.id} value={x.id}>{x.label.slice(0, 70)}</option>)}</select></div>
        </div>
      )}

      {q && draft.kind === 'open' && (
        <div data-testid="params-open"><label className={LABEL} htmlFor="rule-text">The requirement, in your words</label>
          <AutoTextarea id="rule-text" multiline className={INPUT} value={String(p.text ?? draft.note ?? '')} maxLength={600} placeholder="e.g. The project has a social impact" onChange={(text) => setParams({ text })} />
          <p className="mt-1 text-[11px] text-gray-500">An open requirement always goes to a person (To validate). If you can, a closed question is better: you can turn this into one afterwards.</p></div>
      )}

      {q && draft.kind && draft.kind !== 'open' && (
        <div><label className={LABEL} htmlFor="rule-note">{draft.kind.startsWith('doc_') ? 'What the applicants are told about this document (optional)' : 'A note (optional)'}</label>
          <AutoTextarea id="rule-note" multiline className={INPUT} value={draft.note} maxLength={600} onChange={(note) => set({ note })} />
          {draft.kind.startsWith('doc_') && <p className="mt-1 text-[11px] text-gray-500">The platform prepares how to check the document from the question and from this text. You do not need to describe the check.</p>}</div>
      )}

      {sentence && <p className="rounded bg-[#E8F4F8] px-2.5 py-2 text-sm text-gray-900 [overflow-wrap:anywhere]" data-testid="rule-preview"><b>The rule, in one sentence:</b> {sentence}</p>}
      {error && <p role="alert" className="text-xs text-[#B00000]" data-testid="rule-form-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY} disabled={busy} data-testid="rule-save" onClick={onSave}>{busy ? 'Saving…' : 'Save the rule'}</button>
        <button type="button" className={BTN} disabled={busy} data-testid="rule-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
