'use client';
// Prompt 924 (Etapa 4, I1) — Results → Prepare. What each application will be told, before anything reaches anybody: how many are Selected / Not selected / on the Waiting list (from the decisions of the evaluation
// board), who still has no decision (nothing can be published while any does), the name and the message of each result, the options (feedback, contestations, how long the data is kept, the next phase) and a preview
// with a real application. Everything autosaves and nothing is sent from here. The feedback of an application is written by the administrator, in its own box — never from the evaluators' comments.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RichText } from '@/components/RichText';
import { RichTextEditor } from '@/components/RichTextEditor';
import { RESULT_KEYS, MAX_FEEDBACK, type BuiltMessage, type EligibilityReasonMode, type PrepareView, type ResultKey } from '@/lib/calls/results';
import { callsApi } from './api';
import { SaveStatus, type SaveState } from './SaveStatus';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const CARD = 'min-w-0 rounded-xl border border-gray-200 bg-white p-4';
const DEBOUNCE_MS = 700;
const TITLE: Record<ResultKey, string> = { advance: 'Advance', reject: 'Reject', waitlist: 'Waitlist' };

interface Form {
  labels: Record<ResultKey, string>; messages: Record<ResultKey, string>; eligibilityReasonMode: EligibilityReasonMode; feedbackEnabled: boolean; contestationsEnabled: boolean; shareGrade: boolean;
  contestationDays: string; retentionMonths: string; nextStepsText: string; nextStepsDate: string;
}
const formOf = (v: PrepareView): Form => ({
  labels: { ...v.labels }, messages: { ...v.messages }, eligibilityReasonMode: v.settings.eligibilityReasonMode, feedbackEnabled: v.settings.feedbackEnabled, contestationsEnabled: v.settings.contestationsEnabled, shareGrade: v.settings.shareGrade,
  contestationDays: String(v.settings.contestationDays), retentionMonths: String(v.settings.retentionMonths), nextStepsText: v.settings.nextStepsText, nextStepsDate: v.settings.nextStepsDate ?? '',
});

export function PrepareResults({ callId, locked = false, lockedReason = null, onOpenEvaluation }: { callId: string; locked?: boolean; lockedReason?: string | null; onOpenEvaluation?: () => void }) {
  const [view, setView] = useState<PrepareView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [save, setSave] = useState<{ state: SaveState; message?: string }>({ state: 'idle' });
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);

  const load = useCallback(async () => {
    const r = await callsApi.results(callId);
    if (!r.ok) { setError(r.body.error ?? 'Could not load the results.'); return; }
    setView(r.body); setForm((f) => f ?? formOf(r.body));
  }, [callId]);
  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (Object.keys(pending.current).length > 0) {
        const patch = pending.current; pending.current = {};
        setSave({ state: 'saving' });
        const r = await callsApi.resultsSave(callId, patch);
        if (!r.ok) { pending.current = { ...patch, ...pending.current }; setSave({ state: 'error', message: r.body.error }); return; }
        setView(r.body);                                                   // the summary and what blocks publishing follow; what is being typed is never replaced
        setSave({ state: Object.keys(pending.current).length > 0 ? 'saving' : 'saved' });
      }
    } finally { running.current = false; }
  }, [callId]);
  const change = (patch: Record<string, unknown>) => {
    pending.current = { ...pending.current, ...patch };
    setSave((s) => (s.state === 'saving' ? s : { state: 'dirty' }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); void flush(); }, [flush]);
  /** Whatever is waiting to be saved is saved (and a save in flight finishes) before something is built from the saved settings. */
  const flushNow = async () => { if (timer.current) clearTimeout(timer.current); while (running.current) await new Promise((r) => setTimeout(r, 40)); await flush(); };

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="results-error">{error}</p>;
  if (!view || !form) return <p className="text-sm text-gray-400" data-testid="results-loading">Loading…</p>;
  const off = locked || view.locked;
  const lockNote = lockedReason ?? view.lockedReason;
  const set = (next: Form) => setForm(next);

  return (
    <div className="min-w-0 space-y-4" data-testid="prepare-results">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm text-gray-600">Nothing here reaches an applicant. {view.phase.name && view.phase.hasNext ? `This is the result of “${view.phase.name}”.` : ''}</p>
        <SaveStatus state={save.state} message={save.message} onRetry={() => void flush()} onReload={() => void load()} />
      </div>
      {lockNote && <p role="status" className="rounded-lg bg-sky-50 px-4 py-2.5 text-xs text-sky-900" data-testid="results-locked">{lockNote}</p>}

      <Summary view={view} onOpenEvaluation={onOpenEvaluation} />

      <section className={CARD} data-testid="result-messages">
        <h2 className="text-sm font-semibold text-gray-900">What applicants are told</h2>
        <p className="mt-1 text-xs text-gray-500">One message for each result. The fields in curly brackets fill themselves in for each applicant. The evaluators’ comments and scores are never part of a message.</p>
        <div className="mt-3 space-y-5">
          {RESULT_KEYS.map((k) => (
            <ResultEditor key={k} resultKey={k} view={view} form={form} disabled={off}
              onLabel={(v) => { set({ ...form, labels: { ...form.labels, [k]: v } }); change({ labels: { ...form.labels, [k]: v === view.defaults.labels[k] ? '' : v } }); }}
              onMessage={(v) => { const next = { ...form, messages: { ...form.messages, [k]: v } }; set(next); change({ messages: customMessages(next, view) }); }}
              onReset={() => { const next = { ...form, labels: { ...form.labels, [k]: view.defaults.labels[k] }, messages: { ...form.messages, [k]: view.defaults.messages[k] } }; set(next); change({ labels: { ...next.labels, [k]: '' }, messages: customMessages(next, view) }); }} />
          ))}
        </div>
      </section>

      <Preview view={view} callId={callId} flushNow={flushNow} />

      <section className={CARD} data-testid="result-options">
        <h2 className="text-sm font-semibold text-gray-900">Options</h2>
        <div className="mt-3 space-y-3 text-sm">
          <fieldset className="min-w-0" data-testid="opt-eligibility-reason">
            <legend className="text-sm text-gray-800">Applicants whose eligibility was “Not a fit”{view.summary.byEligibility > 0 ? ` (${view.summary.byEligibility} application${view.summary.byEligibility === 1 ? '' : 's'})` : ''}: what are they told about why?</legend>
            {([['none', 'Do not mention it'], ['general', 'A general sentence (“Your application did not meet the eligibility requirements of this call.”)'], ['rule', 'The sentence of the requirement that was not met']] as [EligibilityReasonMode, string][]).map(([k, text]) => (
              <label key={k} className="mt-1 flex items-start gap-2"><input type="radio" name="eligibility-reason-mode" className="mt-1" disabled={off} checked={form.eligibilityReasonMode === k} data-testid={`eligibility-mode-${k}`}
                onChange={() => { set({ ...form, eligibilityReasonMode: k }); change({ eligibilityReasonMode: k }); }} /> <span className="min-w-0">{text}</span></label>
            ))}
            <p className="mt-1 text-[11px] text-gray-500">It goes where the message of “{view.labels.reject}” has the field <span className="merge-tag">Eligibility reason</span>, before the farewell. It is never the platform’s own text nor an internal justification.</p>
          </fieldset>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={off} checked={form.feedbackEnabled} data-testid="opt-feedback"
            onChange={(e) => { set({ ...form, feedbackEnabled: e.target.checked }); change({ feedbackEnabled: e.target.checked }); }} />
            <span className="min-w-0">Feedback to the applicant. Off by default: you write it, application by application, below.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={off} checked={form.shareGrade} data-testid="opt-share-grade"
            onChange={(e) => { set({ ...form, shareGrade: e.target.checked }); change({ shareGrade: e.target.checked }); }} />
            <span className="min-w-0">Tell each applicant their grade. Off by default. Only the grade you validate below is sent — never the average of the evaluations, never an evaluator’s score.</span></label>
          <div>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={off} checked={form.contestationsEnabled} data-testid="opt-contestations"
              onChange={(e) => { set({ ...form, contestationsEnabled: e.target.checked }); change({ contestationsEnabled: e.target.checked }); }} />
              <span className="min-w-0">Applicants who are “Not selected” can contest the decision. Off by default.</span></label>
            {form.contestationsEnabled && (
              <div className="ml-6 mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="opt-days" className="text-xs text-gray-600">They have</label>
                <input id="opt-days" type="number" min={1} max={90} autoComplete="off" className={`${INPUT} !w-20`} disabled={off} value={form.contestationDays} data-testid="opt-contestation-days"
                  onChange={(e) => { set({ ...form, contestationDays: e.target.value }); if (e.target.value) change({ contestationDays: Number(e.target.value) }); }} />
                <span className="text-xs text-gray-600">calendar days after the results are published.</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="opt-retention" className="text-xs text-gray-600">Keep the applicants’ data for</label>
            <input id="opt-retention" type="number" min={1} max={120} autoComplete="off" className={`${INPUT} !w-20`} disabled={off} value={form.retentionMonths} data-testid="opt-retention"
              onChange={(e) => { set({ ...form, retentionMonths: e.target.value }); if (e.target.value) change({ retentionMonths: Number(e.target.value) }); }} />
            <span className="text-xs text-gray-600">months after the call is completed. Then their documents and answers are deleted; only a summary without personal data stays.</span>
          </div>
        </div>
      </section>

      {view.phase.hasNext && (
        <section className={CARD} data-testid="next-steps">
          <h2 className="text-sm font-semibold text-gray-900">Next steps for those who move on</h2>
          <p className="mt-1 text-xs text-gray-500">Goes where the message says {'{next_steps}'}: what happens in the next phase, and when.</p>
          <label htmlFor="ns-text" className="mt-3 block text-xs font-medium text-gray-600">What happens next</label>
          <textarea id="ns-text" rows={3} autoComplete="off" className={INPUT} disabled={off} value={form.nextStepsText} maxLength={2000} data-testid="next-steps-text"
            onChange={(e) => { set({ ...form, nextStepsText: e.target.value }); change({ nextStepsText: e.target.value }); }} />
          <label htmlFor="ns-date" className="mt-3 block text-xs font-medium text-gray-600">Date of the next phase</label>
          <input id="ns-date" type="date" autoComplete="off" className={`${INPUT} sm:!w-48`} disabled={off} value={form.nextStepsDate} data-testid="next-steps-date"
            onChange={(e) => { set({ ...form, nextStepsDate: e.target.value }); change({ nextStepsDate: e.target.value || null }); }} />
        </section>
      )}

      {view.settings.shareGrade && <GradeList callId={callId} view={view} disabled={off} onView={setView} />}
      {view.settings.feedbackEnabled && <FeedbackList callId={callId} view={view} disabled={off} onView={setView} />}
    </div>
  );
}

/** A message that is the default text is not stored as the entity's own: only what was changed is kept (the default follows the language of the call). */
function customMessages(f: Form, v: PrepareView): Partial<Record<ResultKey, string>> {
  const out: Partial<Record<ResultKey, string>> = {};
  for (const k of RESULT_KEYS) if (f.messages[k] !== v.defaults.messages[k]) out[k] = f.messages[k];
  return out;
}

function Summary({ view, onOpenEvaluation }: { view: PrepareView; onOpenEvaluation?: () => void }) {
  const { summary } = view;
  return (
    <section className={CARD} data-testid="results-summary">
      <h2 className="text-sm font-semibold text-gray-900">{summary.total} submitted application{summary.total === 1 ? '' : 's'}</h2>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {RESULT_KEYS.map((k) => (
          <li key={k} className="min-w-0 rounded-lg bg-gray-50 px-3 py-2" data-testid={`count-${k}`}>
            <p className="text-2xl font-bold text-gray-900">{summary.counts[k]}</p>
            <p className="min-w-0 text-xs text-gray-600 [overflow-wrap:anywhere]">{view.labels[k]}</p>
          </li>
        ))}
      </ul>
      {summary.byEligibility > 0 && <p className="mt-2 text-xs text-gray-500">{summary.byEligibility} of the “{view.labels.reject}” are applications whose eligibility was “Not a fit” and that have no decision on the board.</p>}
      {summary.pending.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" role="alert" data-testid="pending-warning">
          <p className="font-medium">{summary.pending.length} application{summary.pending.length === 1 ? ' has' : 's have'} no decision yet.</p>
          <p className="mt-0.5 text-xs">The results cannot be published until every application has one. {summary.pending.slice(0, 8).map((p) => p.reference ?? p.startupName ?? 'an application').join(', ')}{summary.pending.length > 8 ? ` and ${summary.pending.length - 8} more` : ''}.</p>
          {onOpenEvaluation && <button type="button" className={`${BTN} mt-2`} onClick={onOpenEvaluation} data-testid="go-evaluation">Decide them on the evaluation board</button>}
        </div>
      )}
      {view.blockers.filter((b) => b.code !== 'pending').map((b) => <p key={b.code} className="mt-2 text-xs text-gray-600" data-testid={`blocker-${b.code}`}>{b.text}</p>)}
    </section>
  );
}

function ResultEditor({ resultKey: k, view, form, disabled, onLabel, onMessage, onReset }: {
  resultKey: ResultKey; view: PrepareView; form: Form; disabled: boolean; onLabel: (v: string) => void; onMessage: (v: string) => void; onReset: () => void;
}) {
  const label = form.labels[k];
  const changed = label !== view.defaults.labels[k] || form.messages[k] !== view.defaults.messages[k];
  return (
    <div className="min-w-0 border-t border-gray-100 pt-4 first:border-0 first:pt-0" data-testid={`result-${k}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`label-${k}`} className="block text-xs font-medium text-gray-600">{TITLE[k]} — shown to the applicant as</label>
          <input id={`label-${k}`} autoComplete="off" className={INPUT} maxLength={60} disabled={disabled} value={label} data-testid={`label-${k}`} onChange={(e) => onLabel(e.target.value)} />
        </div>
        <button type="button" className={BTN} disabled={disabled || !changed} onClick={onReset} data-testid={`reset-${k}`}>Use the default text</button>
      </div>
      <p id={`msg-label-${k}`} className="mb-1 mt-3 text-xs font-medium text-gray-600">Message</p>
      <RichTextEditor id={`msg-${k}`} labelledBy={`msg-label-${k}`} value={form.messages[k]} disabled={disabled} onChange={onMessage} mergeFields={[...view.placeholders]} />
    </div>
  );
}

function Preview({ view, callId, flushNow }: { view: PrepareView; callId: string; flushNow: () => Promise<void> }) {
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState<BuiltMessage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const withResult = view.applications.filter((a) => a.result);
  async function run() {
    if (!pick) return;
    setBusy(true); setError(''); setMsg(null);
    await flushNow();
    const r = await callsApi.resultsPreview(callId, pick);
    setBusy(false);
    if (!r.ok) setError(r.body.error ?? 'Could not build the preview.'); else setMsg(r.body.message);
  }
  return (
    <section className={CARD} data-testid="result-preview">
      <h2 className="text-sm font-semibold text-gray-900">Preview with a real application</h2>
      <p className="mt-1 text-xs text-gray-500">Shows exactly what that applicant would receive with the messages as they are now. Changes are saved before it is built. Nothing is sent.</p>
      {withResult.length === 0 ? <p className="mt-2 text-sm text-gray-500">No application has a result yet: decide some on the evaluation board.</p> : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="preview-pick" className="block text-xs font-medium text-gray-600">Application</label>
            <select id="preview-pick" className={INPUT} value={pick} onChange={(e) => { setPick(e.target.value); setMsg(null); setError(''); }} data-testid="preview-pick">
              <option value="">Choose…</option>
              {withResult.map((a) => <option key={a.applicationId} value={a.applicationId}>{(a.startupName ?? a.reference ?? 'Application')} — {a.label}</option>)}
            </select>
          </div>
          <button type="button" className={BTN} disabled={!pick || busy} onClick={() => void run()} data-testid="preview-build">{busy ? 'Building…' : 'Show preview'}</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[#B00000]">{error}</p>}
      {msg && (
        <div className="mt-3 min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3" data-testid="preview-message">
          <p className="text-xs text-gray-500">Subject</p>
          <p className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]" data-testid="preview-subject">{msg.subject}</p>
          <RichText value={msg.html} className="mt-2 text-sm text-gray-800" testId="preview-body" />
        </div>
      )}
    </section>
  );
}

/** The grade an administrator VALIDATES for each evaluated application (0–100 %). Only this is ever sent; the board's average is for administrators and is never what goes out. */
function GradeList({ callId, view, disabled, onView }: { callId: string; view: PrepareView; disabled: boolean; onView: (v: PrepareView) => void }) {
  const [text, setText] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, string | undefined>>({});
  const evaluated = view.applications.filter((a) => a.source === 'decision');
  const value = (id: string, stored: number | null) => (id in text ? text[id] : stored === null ? '' : String(stored));
  async function commit(id: string, stored: number | null) {
    const v = value(id, stored);
    if (v.trim() === (stored === null ? '' : String(stored))) return;
    const r = await callsApi.resultsGrade(callId, id, v);
    if (!r.ok) { setState((s) => ({ ...s, [id]: r.body.error ?? 'Could not save.' })); return; }
    setState((s) => ({ ...s, [id]: 'saved' })); onView(r.body);
  }
  const missing = evaluated.filter((a) => a.grade === null).length;
  return (
    <section className={CARD} data-testid="grade-list">
      <h2 className="text-sm font-semibold text-gray-900">Validated grade</h2>
      <p className="mt-1 text-xs text-gray-500">The grade you validate for each application, from 0 to 100. It is sent to the applicant exactly as written here. {missing > 0 ? `${missing} still without a grade: they are needed before the results can be published.` : 'Every evaluated application has one.'}</p>
      {evaluated.length === 0 && <p className="mt-2 text-sm text-gray-500">No application has a decision yet.</p>}
      <ul className="mt-3 space-y-2">
        {evaluated.map((a) => (
          <li key={a.applicationId} className="flex min-w-0 flex-wrap items-center gap-2" data-testid="grade-item">
            <label htmlFor={`gr-${a.applicationId}`} className="min-w-0 flex-1 text-xs font-medium text-gray-700 [overflow-wrap:anywhere]">{a.startupName ?? a.reference ?? 'Application'}{a.reference && a.startupName ? ` (${a.reference})` : ''} — {a.label}</label>
            <input id={`gr-${a.applicationId}`} inputMode="decimal" autoComplete="off" className={`${INPUT} !w-24`} disabled={disabled} value={value(a.applicationId, a.grade)} data-testid="grade-input" placeholder="0 – 100"
              onChange={(e) => setText((t) => ({ ...t, [a.applicationId]: e.target.value }))} onBlur={() => void commit(a.applicationId, a.grade)} />
            <span className="text-xs text-gray-500">%</span>
            {state[a.applicationId] && state[a.applicationId] !== 'saved' && <span role="alert" className="basis-full text-[11px] text-[#B00000]">{state[a.applicationId]}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeedbackList({ callId, view, disabled, onView }: { callId: string; view: PrepareView; disabled: boolean; onView: (v: PrepareView) => void }) {
  const [text, setText] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, 'saved' | 'error' | undefined>>({});
  const value = (id: string, stored: string) => (id in text ? text[id] : stored);
  async function commit(id: string, stored: string) {
    const v = value(id, stored);
    if (v.trim() === stored.trim()) return;
    const r = await callsApi.resultsFeedback(callId, id, v);
    if (!r.ok) { setState((s) => ({ ...s, [id]: 'error' })); return; }
    setState((s) => ({ ...s, [id]: 'saved' })); onView(r.body);
  }
  return (
    <section className={CARD} data-testid="feedback-list">
      <h2 className="text-sm font-semibold text-gray-900">Feedback to the applicant</h2>
      <p className="mt-1 text-xs text-gray-500">Written by you, for the applicant: it goes at the end of the message, only when it is filled in. It is never filled in from the evaluators’ comments.</p>
      <ul className="mt-3 space-y-3">
        {view.applications.map((a) => (
          <li key={a.applicationId} className="min-w-0" data-testid="feedback-item">
            <label htmlFor={`fb-${a.applicationId}`} className="block text-xs font-medium text-gray-700 [overflow-wrap:anywhere]">{a.startupName ?? a.reference ?? 'Application'}{a.reference && a.startupName ? ` (${a.reference})` : ''} — {a.label ?? 'no decision yet'}</label>
            <textarea id={`fb-${a.applicationId}`} rows={2} autoComplete="off" className={INPUT} disabled={disabled} maxLength={MAX_FEEDBACK} value={value(a.applicationId, a.feedback)} data-testid="feedback-input"
              onChange={(e) => setText((t) => ({ ...t, [a.applicationId]: e.target.value }))} onBlur={() => void commit(a.applicationId, a.feedback)} />
            {state[a.applicationId] === 'saved' && <span className="text-[11px] text-emerald-700">Saved</span>}
            {state[a.applicationId] === 'error' && <span role="alert" className="text-[11px] text-[#B00000]">Could not save. Try again.</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
