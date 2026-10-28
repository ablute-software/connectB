'use client';
// Prompt 918 (I3) — the eligibility of ONE application, in its detail (spec §7.5, §7.6): the result in plain words, each rule with what the platform found (the quote and the page of the document), and
// what a person can do — correct one rule, reclassify the application, or flag it for validation. Every correction asks for a reason, in the page (never a browser dialog), and the platform recomputes
// the rest. A "Technical failure" is said as one: it was never counted against the applicant.
import { useState } from 'react';
import { ELIGIBILITY_LABEL, type EligibilityInfo, type RuleLine } from '@/lib/calls/eligibility-payload';

const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm';
const TONE: Record<string, string> = { fit: 'bg-emerald-50 text-emerald-900', not_fit: 'bg-red-50 text-[#8a0000]', to_validate: 'bg-amber-50 text-amber-900', queued: 'bg-gray-100 text-gray-700', processing: 'bg-gray-100 text-gray-700', technical_failure: 'bg-red-50 text-[#8a0000]' };
const OUTCOME: Record<string, { label: string; cls: string }> = { pass: { label: 'Met', cls: 'bg-emerald-100 text-emerald-900' }, fail: { label: 'Not met', cls: 'bg-red-100 text-[#8a0000]' }, validate: { label: 'Needs a person', cls: 'bg-amber-100 text-amber-900' } };

type Form = { kind: 'rule'; rule: RuleLine; outcome: 'pass' | 'fail' } | { kind: 'reclassify'; status: 'fit' | 'not_fit' } | { kind: 'flag' } | null;

export function ApplicationEligibility({ callId, applicationId, info, canCorrect, canFlag, onChanged }: {
  callId: string; applicationId: string; info: EligibilityInfo; canCorrect: boolean; canFlag: boolean; onChanged: () => void;
}) {
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

      {info.rules.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="eligibility-rules">
          {info.rules.map((r) => (
            <li key={r.ruleId} className="min-w-0 rounded-lg bg-gray-50 p-2.5" data-testid="eligibility-rule">
              <div className="flex flex-wrap items-start gap-2">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME[r.effective].cls}`} data-testid="rule-outcome">{OUTCOME[r.effective].label}</span>
                <p className="min-w-0 flex-1 text-xs text-gray-700 [overflow-wrap:anywhere]">{r.sentence}</p>
              </div>
              <p className="mt-1 text-sm text-gray-900 [overflow-wrap:anywhere]">{r.reason}</p>
              {r.evidence && (r.evidence.quote || r.evidence.fileName) && (
                <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-gray-600 [overflow-wrap:anywhere]" data-testid="rule-evidence">
                  {r.evidence.fileName && <span className="font-medium">{r.evidence.fileName}</span>}{r.evidence.page ? ` · page ${r.evidence.page}` : ''}{r.evidence.quote ? <> — “{r.evidence.quote}”</> : null}
                </p>
              )}
              {r.override && <p className="mt-1 text-xs text-gray-500" data-testid="rule-override">The platform said “{OUTCOME[r.engine].label}”; a person decided “{OUTCOME[r.override.outcome].label}” — “{r.override.why}”</p>}
              {canCorrect && evaluated && !form && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.effective !== 'pass' && <button type="button" className={BTN} data-testid="rule-mark-met" onClick={() => { setForm({ kind: 'rule', rule: r, outcome: 'pass' }); setError(''); }}>Mark as met</button>}
                  {r.effective !== 'fail' && <button type="button" className={BTN} data-testid="rule-mark-notmet" onClick={() => { setForm({ kind: 'rule', rule: r, outcome: 'fail' }); setError(''); }}>Mark as not met</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {evaluated && !form && (canCorrect || canFlag) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canCorrect && info.state !== 'fit' && <button type="button" className={BTN} data-testid="reclassify-fit" onClick={() => { setForm({ kind: 'reclassify', status: 'fit' }); setError(''); }}>Reclassify as Fit</button>}
          {canCorrect && info.state !== 'not_fit' && <button type="button" className={BTN} data-testid="reclassify-notfit" onClick={() => { setForm({ kind: 'reclassify', status: 'not_fit' }); setError(''); }}>Reclassify as Not a fit</button>}
          {!canCorrect && canFlag && info.state !== 'to_validate' && <button type="button" className={BTN} data-testid="flag" onClick={() => { setForm({ kind: 'flag' }); setError(''); }}>Flag possible ineligibility</button>}
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
