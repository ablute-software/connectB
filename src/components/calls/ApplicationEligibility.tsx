'use client';
// Prompt 918 (I3) — the eligibility of ONE application, in its detail (spec §7.5, §7.6): the result in plain words, each rule with what the platform found (the quote and the page of the document), and
// what a person can do — correct one rule, reclassify the application, or flag it for validation. Every correction asks for a reason, in the page (never a browser dialog), and the platform recomputes
// the rest. A "Technical failure" is said as one: it was never counted against the applicant.
// Prompt 930 (B): the two ways to reclassify sit at the top, in view, next to the result ("Mark as Fit" green, "Mark as Not a fit" red; the current one is marked and off), "Flag possible ineligibility" is the quiet
// action beside them; the rules are split in "Unmet", "To validate" and "Met" (it opens on the one that explains the result), each with the sentence, the reason, the evidence — the applicant's answer, or the quote
// and the page of the document — and "Open document", which opens the document inside the platform (the viewer of the data room), never as a download.
import { useMemo, useState } from 'react';
import { ELIGIBILITY_LABEL, type EligibilityInfo, type RuleLine } from '@/lib/calls/eligibility-payload';
import type { Answers, FormField } from '@/lib/calls/types';
import { ScrollTabs } from '@/components/ScrollTabs';
import { useDocViewer } from './DocViewer';
import { answerText } from '@/lib/calls/answer-text';

const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm';
const TONE: Record<string, string> = { fit: 'bg-emerald-50 text-emerald-900', not_fit: 'bg-red-50 text-[#8a0000]', to_validate: 'bg-amber-50 text-amber-900', queued: 'bg-gray-100 text-gray-700', processing: 'bg-gray-100 text-gray-700', technical_failure: 'bg-red-50 text-[#8a0000]' };
const OUTCOME: Record<string, { label: string; cls: string }> = { pass: { label: 'Met', cls: 'bg-emerald-100 text-emerald-900' }, fail: { label: 'Not met', cls: 'bg-red-100 text-[#8a0000]' }, validate: { label: 'Needs a person', cls: 'bg-amber-100 text-amber-900' } };
const FIT_BTN = 'min-h-[44px] rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:border-emerald-300 disabled:bg-emerald-50 disabled:text-emerald-900 sm:min-h-0 sm:py-1 sm:text-xs';
const NOT_FIT_BTN = 'min-h-[44px] rounded-lg border border-[#B00000] bg-[#B00000] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#8a0000] disabled:border-red-300 disabled:bg-red-50 disabled:text-[#8a0000] sm:min-h-0 sm:py-1 sm:text-xs';

/** The three lists of rules, in the order a person reads them: what was NOT met, what needs a person, what was met. */
export type RuleTab = 'unmet' | 'validate' | 'met';
export const RULE_TABS: { key: RuleTab; label: string; outcome: RuleLine['effective'] }[] = [{ key: 'unmet', label: 'Unmet', outcome: 'fail' }, { key: 'validate', label: 'To validate', outcome: 'validate' }, { key: 'met', label: 'Met', outcome: 'pass' }];
/** Which list opens first: "Unmet" for a Not a fit, "To validate" for a To validate; a Fit opens on "Met". If that list is empty (a person reclassified it with no rule behind), the first one that has something. */
export function initialRuleTab(state: EligibilityInfo['state'], rules: Pick<RuleLine, 'effective'>[]): RuleTab {
  const want: RuleTab = state === 'not_fit' ? 'unmet' : state === 'to_validate' ? 'validate' : 'met';
  const has = (k: RuleTab) => rules.some((r) => r.effective === RULE_TABS.find((x) => x.key === k)!.outcome);
  return has(want) ? want : (RULE_TABS.find((x) => has(x.key))?.key ?? want);
}

type Form = { kind: 'rule'; rule: RuleLine; outcome: 'pass' | 'fail' } | { kind: 'reclassify'; status: 'fit' | 'not_fit' } | { kind: 'flag' } | null;

export function ApplicationEligibility({ callId, applicationId, info, canCorrect, canFlag, onChanged, documents = [], fields = [], answers = {}, currency = 'EUR' }: {
  callId: string; applicationId: string; info: EligibilityInfo; canCorrect: boolean; canFlag: boolean; onChanged: () => void;
  /** The documents of the application, the form and the answers (so a rule can show the answer it was decided on and open its document). */
  documents?: { fileId: string; fileName: string }[]; fields?: FormField[]; answers?: Answers; currency?: string;
}) {
  const openDoc = useDocViewer();
  const [tab, setTab] = useState<RuleTab | null>(null);
  const current = tab ?? initialRuleTab(info.state, info.rules);
  const counts = useMemo(() => Object.fromEntries(RULE_TABS.map((x) => [x.key, info.rules.filter((r) => r.effective === x.outcome).length])) as Record<RuleTab, number>, [info.rules]);
  const [form, setForm] = useState<Form>(null);
  const [why, setWhy] = useState('');
  const [exception, setException] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/calls/${callId}/submissions/${applicationId}/eligibility`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setError(d.error ?? 'We could not save that.'); return; }
      setForm(null); setWhy(''); setException(false); onChanged();
    } catch { setError('We could not reach the server. Try again.'); } finally { setBusy(false); }
  }
  const submit = () => {
    if (!form) return;
    if (!why.trim()) { setError(form.kind === 'flag' ? 'Say what makes you think it may not be eligible.' : 'Say why: a correction always has a reason.'); return; }
    if (form.kind === 'rule') void post({ action: 'correct_rule', ruleId: form.rule.ruleId, outcome: form.outcome, justification: why, callException: exception });
    else if (form.kind === 'reclassify') void post({ action: 'reclassify', status: form.status, justification: why, callException: exception });
    else void post({ action: 'flag', reason: why });
  };

  const evaluated = info.state !== 'queued' && info.state !== 'processing' && info.state !== 'technical_failure';
  return (
    <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4" aria-label="Eligibility" data-testid="eligibility-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Eligibility</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[info.state]}`} data-testid="eligibility-state">{ELIGIBILITY_LABEL[info.state]}</span>
        {info.source === 'human' && <span className="text-[11px] text-gray-500">decided by a person</span>}
        {info.source === 'flag' && <span className="text-[11px] text-gray-500">flagged by a person</span>}
        {info.rulesVersion !== null && <span className="text-[11px] text-gray-400">rules version {info.rulesVersion}</span>}
      </div>
      <p className="mt-1 text-sm text-gray-800 [overflow-wrap:anywhere]" data-testid="eligibility-reason">{info.reason}</p>
      {info.state === 'technical_failure' && canCorrect && (
        <button type="button" className={`${BTN} mt-2`} disabled={busy} data-testid="eligibility-retry" onClick={() => void post({ action: 'retry' })}>Retry the check</button>
      )}
      {info.reclassified && <p className="mt-1 text-xs text-gray-500" data-testid="eligibility-reclassified">Reclassified as {info.reclassified.status === 'fit' ? 'Fit' : 'Not a fit'} — “{info.reclassified.why}”</p>}

      {evaluated && !form && (canCorrect || canFlag) && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="eligibility-actions">
          {canCorrect && <button type="button" className={FIT_BTN} disabled={info.state === 'fit'} aria-pressed={info.state === 'fit'} data-testid="reclassify-fit" onClick={() => { setForm({ kind: 'reclassify', status: 'fit' }); setError(''); }}>{info.state === 'fit' ? '✓ Fit (current)' : 'Mark as Fit'}</button>}
          {canCorrect && <button type="button" className={NOT_FIT_BTN} disabled={info.state === 'not_fit'} aria-pressed={info.state === 'not_fit'} data-testid="reclassify-notfit" onClick={() => { setForm({ kind: 'reclassify', status: 'not_fit' }); setError(''); }}>{info.state === 'not_fit' ? '✓ Not a fit (current)' : 'Mark as Not a fit'}</button>}
          {canFlag && info.state !== 'to_validate' && <button type="button" className={`${BTN} sm:ml-2`} data-testid="flag" onClick={() => { setForm({ kind: 'flag' }); setError(''); }}>Flag possible ineligibility</button>}
        </div>
      )}

      {info.rules.length > 0 && (
        <div className="mt-4 min-w-0" data-testid="eligibility-rules">
          <ScrollTabs label="Rules" testId="rule-tabs" className="flex gap-1 border-b border-gray-200">
            {RULE_TABS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={current === x.key} data-testid={`rules-${x.key}`} onClick={() => setTab(x.key)}
                className={`-mb-px min-h-[44px] shrink-0 border-b-2 px-3 py-2 text-sm sm:min-h-0 ${current === x.key ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{x.label} ({counts[x.key]})</button>
            ))}
          </ScrollTabs>
          {counts[current] === 0 && <p className="mt-3 text-sm text-gray-500" data-testid="rules-empty">No rule in this list.</p>}
          <ul className="mt-3 space-y-2">
            {info.rules.filter((r) => r.effective === RULE_TABS.find((x) => x.key === current)!.outcome).map((r) => {
              const field = r.fieldId ? fields.find((f) => f.id === r.fieldId) : undefined;
              const doc = r.evidence?.fileName ? documents.find((d) => d.fileName === r.evidence!.fileName) : undefined;
              const answer = field && field.kind !== 'file' ? answerText(field, answers[field.id], currency) : null;
              return (
                <li key={r.ruleId} className="min-w-0 rounded-lg bg-gray-50 p-2.5" data-testid="eligibility-rule">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME[r.effective].cls}`} data-testid="rule-outcome">{OUTCOME[r.effective].label}</span>
                    <p className="min-w-0 flex-1 text-xs text-gray-700 [overflow-wrap:anywhere]" data-testid="rule-sentence">{r.sentence}</p>
                  </div>
                  <p className="mt-1 text-sm text-gray-900 [overflow-wrap:anywhere]" data-testid="rule-reason">{r.reason}</p>
                  {(answer !== null || (r.evidence && (r.evidence.quote || r.evidence.fileName))) && (
                    <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-gray-600 [overflow-wrap:anywhere]" data-testid="rule-evidence">
                      {answer !== null && <><span className="font-medium">Answer:</span> {answer}</>}
                      {r.evidence?.fileName && <span className="font-medium">{r.evidence.fileName}</span>}{r.evidence?.page ? ` · page ${r.evidence.page}` : ''}{r.evidence?.quote ? <> — “{r.evidence.quote}”</> : null}
                    </p>
                  )}
                  {doc && openDoc && <button type="button" className={`${BTN} mt-1.5`} data-testid="open-document" onClick={() => openDoc(doc.fileId)}>Open document</button>}
                  {r.override && <p className="mt-1 text-xs text-gray-500" data-testid="rule-override">The platform said “{OUTCOME[r.engine].label}”; a person decided “{OUTCOME[r.override.outcome].label}” — “{r.override.why}”</p>}
                  {canCorrect && evaluated && !form && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.effective !== 'pass' && <button type="button" className={BTN} data-testid="rule-mark-met" onClick={() => { setForm({ kind: 'rule', rule: r, outcome: 'pass' }); setError(''); }}>Mark as met</button>}
                      {r.effective !== 'fail' && <button type="button" className={BTN} data-testid="rule-mark-notmet" onClick={() => { setForm({ kind: 'rule', rule: r, outcome: 'fail' }); setError(''); }}>Mark as not met</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {form && (
        <div className="mt-3 rounded-lg border border-[#0E7490] bg-white p-3" role="group" aria-label="Give the reason" data-testid="eligibility-form">
          <p className="text-sm font-medium text-gray-900">
            {form.kind === 'rule' ? `Mark this rule as ${form.outcome === 'pass' ? 'met' : 'not met'}` : form.kind === 'reclassify' ? `Reclassify this application as ${form.status === 'fit' ? 'Fit' : 'Not a fit'}` : 'Flag possible ineligibility'}
          </p>
          <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="elig-why">{form.kind === 'flag' ? 'What makes you think it may not be eligible?' : 'Why? (required)'}</label>
          <textarea id="elig-why" rows={3} maxLength={1000} className={INPUT} value={why} onChange={(e) => setWhy(e.target.value)} data-testid="eligibility-why" />
          {form.kind !== 'flag' && (
            <label className="mt-2 flex items-start gap-2 text-xs text-gray-700"><input type="checkbox" className="mt-0.5" checked={exception} onChange={(e) => setException(e.target.checked)} data-testid="eligibility-exception" />
              <span>This is an exception of this call, not a mistake of the automatic check.</span></label>
          )}
          {form.kind === 'flag' && <p className="mt-1 text-[11px] text-gray-500">It goes to “To validate”. It is not excluded and colleagues still see it.</p>}
          {error && <p role="alert" className="mt-2 text-xs text-[#B00000]" data-testid="eligibility-error">{error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={submit} className="min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0" data-testid="eligibility-confirm">{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" disabled={busy} onClick={() => { setForm(null); setWhy(''); setError(''); }} className={BTN} data-testid="eligibility-cancel">Cancel</button>
          </div>
        </div>
      )}
      {!form && error && <p role="alert" className="mt-2 text-xs text-[#B00000]">{error}</p>}
    </section>
  );
}
