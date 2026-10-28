'use client';
// Prompt 922 (I3) — the evaluation of ONE application. Wide screens: the application on the left, the grid on the right, side by side; tablet and phone: two tabs, "Application" and "Score". Every change is saved by
// itself a moment later (the evaluator never presses Save); the grade ring follows the scores; the level's description shows under the buttons; comments per criterion, a general comment and a private note that only an
// administrator reads. "Submit evaluation" asks IN the page, then the evaluation is read-only — only an administrator reopens it, with a reason. When the evaluation is blind the server already sent the application
// masked, and says so at the top. Nothing is a browser dialog. The files open through the platform (never a Storage address).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { belowMinimum, gradeText, levelDescription, scaleLabel, scaleLevels, weightedGrade, type Criterion } from '@/lib/calls/eval-grid';
import { isEmptyDraft, mergeDraft, withDraft, type Draft } from '@/lib/calls/eval-draft';
import type { EvaluationPayload } from '@/lib/calls/eval-store';
import { formatDayInZone, formatInZone } from '@/lib/calls/tz';
import { callsApi } from './api';
import { AutoTextarea } from './AutoTextarea';
import { GradeRing } from './EvaluatorPreview';
import { AnswerView } from './SubmissionsTab';

const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';
const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const AUTOSAVE_MS = 700;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
const SAVE_TEXT: Record<SaveState, string> = { idle: '', dirty: 'Not saved yet…', saving: 'Saving…', saved: 'All changes saved', error: 'Not saved — will retry', conflict: 'Changed in another window' };

export function EvaluationScreen({ callId, applicationId, onBack }: { callId: string; applicationId: string; onBack: () => void }) {
  const [data, setData] = useState<EvaluationPayload | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'application' | 'score'>('application');
  const [save, setSave] = useState<SaveState>('idle');
  const [draft, setDraft] = useState<Draft>({});
  const [confirming, setConfirming] = useState(false);
  const [missing, setMissing] = useState<{ criterionId: string; problem: 'score' | 'comment' }[]>([]);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<Set<string>>(new Set());
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictNote, setConflictNote] = useState('');
  const [reopening, setReopening] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [hover, setHover] = useState<{ id: string; level: number } | null>(null);

  const pending = useRef<Draft>({});
  const inflight = useRef(false);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    const r = await callsApi.evaluation(callId, applicationId);
    if (!r.ok) { setError(r.body.error ?? 'Could not open this evaluation.'); return; }
    setError(''); setData(r.body); revision.current = r.body.evaluation.revision; pending.current = {}; setDraft({}); setSave('idle');
    setComments(new Set(Object.entries(r.body.evaluation.scores).filter(([, s]) => s.comment).map(([id]) => id)));
  }, [callId, applicationId]);
  useEffect(() => { void load(); return () => clearTimeout(timer.current); }, [load]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    if (inflight.current) { timer.current = setTimeout(() => void flush(), AUTOSAVE_MS); return false; }
    if (isEmptyDraft(pending.current)) return true;
    const body = pending.current; pending.current = {}; inflight.current = true; setSave('saving');
    const r = await callsApi.saveEvaluation(callId, applicationId, { ...body, revision: revision.current });
    inflight.current = false;
    if (r.ok) {
      revision.current = r.body.revision;
      if (isEmptyDraft(pending.current)) { setSave('saved'); } else { setSave('dirty'); timer.current = setTimeout(() => void flush(), AUTOSAVE_MS); }
      return true;
    }
    pending.current = mergeDraft(body, pending.current);                                   // nothing typed is lost: it goes back to the queue
    if (r.body.code === 'conflict') { setSave('conflict'); setError(r.body.error ?? 'This evaluation was changed in another window.'); return false; }
    if (r.body.code === 'submitted' || r.body.code === 'closed') { setError(r.body.error ?? 'This evaluation can no longer be changed.'); pending.current = {}; void load(); return false; }
    setSave('error'); timer.current = setTimeout(() => void flush(), 4000);
    return false;
  }, [callId, applicationId, load]);

  const change = (d: Draft) => {
    pending.current = mergeDraft(pending.current, d); setDraft(pending.current); setSave('dirty'); setMissing([]);
    clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  const criteria = data?.grid.criteria ?? [];
  const server = data?.evaluation.scores ?? {};
  const scores = useMemo(() => withDraft(server, draft), [server, draft]);
  const numeric = useMemo(() => Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.score])), [scores]);
  const grade = weightedGrade(criteria, numeric);
  const below = belowMinimum(criteria, numeric);
  const overall = draft.overallComment ?? data?.evaluation.overallComment ?? '';
  const note = draft.privateNote ?? data?.evaluation.privateNote ?? '';

  async function submit() {
    setBusy(true); setError('');
    const ok = await waitFlushed();
    if (!ok) { setBusy(false); setConfirming(false); return; }
    const r = await callsApi.submitEvaluation(callId, applicationId, revision.current);
    setBusy(false);
    if (!r.ok) {
      setConfirming(false);
      if (r.body.code === 'incomplete') { setMissing((r.body as { missing?: { criterionId: string; problem: 'score' | 'comment' }[] }).missing ?? []); setError(r.body.error ?? 'Some criteria are missing.'); setTab('score'); return; }
      setError(r.body.error ?? 'It could not be submitted. Please try again.'); if (r.body.code === 'conflict') setSave('conflict'); return;
    }
    setConfirming(false); await load();
  }
  async function waitFlushed(): Promise<boolean> {
    for (let i = 0; i < 20; i++) { if (await flush()) { if (!inflight.current && isEmptyDraft(pending.current)) return true; } await new Promise((r) => setTimeout(r, 150)); }
    return false;
  }
  async function declare() {
    setBusy(true);
    const r = await callsApi.declareConflict(callId, applicationId, conflictNote);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'Your conflict could not be recorded.'); return; }
    pending.current = {}; onBack();
  }
  async function reopen(evaluatorUserId: string) {
    setBusy(true);
    const r = await callsApi.reopenEvaluation(callId, applicationId, evaluatorUserId, reason);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'It could not be reopened.'); return; }
    setReopening(null); setReason(''); await load();
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <button type="button" className={BTN} onClick={onBack} data-testid="eval-back">← My evaluations</button>
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600" data-testid="eval-loading" role={error ? 'alert' : undefined}>{error || 'Opening the evaluation…'}</p>
      </div>
    );
  }
  const submitted = data.evaluation.status === 'submitted';
  const editable = data.canEdit && !busy;
  const title = `${data.application.reference ?? 'Application'}${data.application.startupName ? ` · ${data.application.startupName}` : ''}`;
  const needs = (id: string) => missing.find((m) => m.criterionId === id)?.problem;

  const applicationPane = (
    <section className="min-w-0 space-y-3" aria-label="Application" data-testid="eval-application">
      {data.blind && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="eval-blind">Blind evaluation: who applied is hidden — the startup, the people and their emails. The documents are open in full.</p>}
      <dl className="space-y-3">
        {data.fields.map((f) => (
          <div key={f.id} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="eval-answer">
            <dt className="text-xs font-semibold text-gray-500 [overflow-wrap:anywhere]">{f.label}</dt>
            <dd className="mt-1 text-sm text-gray-900 [overflow-wrap:anywhere]"><AnswerView field={f} value={data.answers[f.id]} docs={data.documents.map((d) => ({ ...d, size: d.size ?? 0, source: 'upload', versionNumber: null }))} currency={data.currency} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );

  const scorePane = (
    <section className="min-w-0 space-y-3" aria-label="Score" data-testid="eval-score">
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white p-3" data-testid="eval-grade">
        <GradeRing percent={grade.percent} label={gradeText(grade)} />
        <div className="min-w-0 text-sm text-gray-700">
          <p><b>{grade.scored} of {grade.total}</b> criteria scored.</p>
          {grade.percent === null && <p className="text-xs text-gray-500">The grade appears when every criterion has a score.</p>}
          {below.length > 0 && <p className="mt-1 text-xs text-amber-900" data-testid="eval-below">Below the minimum: {below.map((b) => `${b.name} (${b.score} < ${b.min})`).join(', ')}. The application is flagged for the administrator, never excluded.</p>}
        </div>
      </div>

      <ul className="space-y-3">
        {criteria.map((c) => <CriterionScore key={c.id} c={c} entry={scores[c.id]} editable={editable} need={needs(c.id)} forced={data.grid.commentRequiredForAll || c.commentRequired} showComment={comments.has(c.id)} hover={hover?.id === c.id ? hover.level : null}
          onHover={(level) => setHover(level === null ? null : { id: c.id, level })} onScore={(score) => change({ scores: { [c.id]: { score } } })} onComment={(comment) => change({ scores: { [c.id]: { comment } } })} onShowComment={() => setComments((s) => new Set(s).add(c.id))} />)}
      </ul>

      <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="eval-overall">General comment</label>
        <AutoTextarea id="eval-overall" multiline className={INPUT} value={overall} disabled={!editable} maxLength={5000} onChange={(overallComment) => change({ overallComment })} />
        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="eval-note">Private note for the administrator</label>
        <AutoTextarea id="eval-note" multiline className={INPUT} value={note} disabled={!editable} maxLength={5000} onChange={(privateNote) => change({ privateNote })} />
        <p className="mt-1 text-[11px] text-gray-500">Only administrators read this note. Colleagues never do.</p>
      </div>

      {data.colleagues && data.colleagues.length > 0 && (
        <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="eval-colleagues">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{data.role === 'admin' ? 'Submitted evaluations' : 'Your colleagues’ evaluations'}</h4>
          <ul className="mt-2 space-y-2">
            {data.colleagues.map((c) => (
              <li key={c.userId} className="min-w-0 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-800" data-testid="eval-colleague">
                <p className="font-semibold [overflow-wrap:anywhere]">{c.evaluator ?? 'An evaluator'} · {c.gradePercent === null ? 'N/A' : `${c.gradePercent} %`}</p>
                <ul className="mt-1 space-y-0.5">{criteria.map((k) => <li key={k.id} className="[overflow-wrap:anywhere]">{k.name}: <b>{c.scores[k.id]?.score ?? '—'}</b>{c.scores[k.id]?.comment ? ` — ${c.scores[k.id].comment}` : ''}</li>)}</ul>
                {c.overallComment && <p className="mt-1 [overflow-wrap:anywhere]">“{c.overallComment}”</p>}
                {c.privateNote && <p className="mt-1 text-gray-600 [overflow-wrap:anywhere]" data-testid="eval-colleague-note">Private note: {c.privateNote}</p>}
                {data.canReopen && (reopening === c.userId ? (
                  <div className="mt-2 space-y-1.5" role="group" aria-label="Reopen this evaluation" data-testid="eval-reopen-form">
                    <label className="block font-semibold" htmlFor="reopen-reason">Why are you reopening it? (kept with the evaluation)</label>
                    <AutoTextarea id="reopen-reason" multiline className={INPUT} value={reason} maxLength={1000} onChange={setReason} />
                    <div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={busy || reason.trim().length < 5} data-testid="eval-reopen-yes" onClick={() => void reopen(c.userId)}>Reopen it</button><button type="button" className={BTN} onClick={() => { setReopening(null); setReason(''); }}>Cancel</button></div>
                  </div>
                ) : <button type="button" className={`${BTN} mt-2`} data-testid="eval-reopen" onClick={() => setReopening(c.userId)}>Reopen…</button>)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && (
        <div className="rounded-lg border border-[#0E7490] bg-white p-3" role="group" aria-label="Confirm submitting" data-testid="eval-confirm">
          <p className="text-sm text-gray-800">Submit your evaluation? After this you cannot change it: only an administrator can reopen it.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} data-testid="eval-confirm-yes" onClick={() => void submit()}>{busy ? 'Submitting…' : 'Yes, submit'}</button>
            <button type="button" className={BTN} disabled={busy} data-testid="eval-confirm-no" onClick={() => setConfirming(false)}>Keep editing</button>
          </div>
        </div>
      )}

      {conflictOpen && (
        <div className="min-w-0 rounded-lg border border-gray-300 bg-white p-3" role="group" aria-label="I have a conflict" data-testid="eval-conflict-form">
          <p className="text-sm font-semibold text-gray-900">You will not evaluate this application.</p>
          <p className="mt-0.5 text-xs text-gray-600">It is taken off your list and given to someone else. Your draft, if you started one, is discarded.</p>
          <label className="mt-2 block text-xs font-semibold text-gray-700" htmlFor="conflict-note">Reason (optional — only administrators see it)</label>
          <AutoTextarea id="conflict-note" multiline className={INPUT} value={conflictNote} maxLength={1000} onChange={setConflictNote} />
          <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={busy} data-testid="eval-conflict-yes" onClick={() => void declare()}>Yes, I have a conflict</button><button type="button" className={BTN} disabled={busy} onClick={() => setConflictOpen(false)}>Cancel</button></div>
        </div>
      )}

      {data.canEdit && !confirming && !conflictOpen && (
        <div className="flex flex-wrap items-center gap-2" data-testid="eval-actions">
          <button type="button" className={PRIMARY} disabled={busy} data-testid="eval-submit" onClick={() => { setError(''); setConfirming(true); }}>Submit evaluation</button>
          <button type="button" className={BTN} disabled={busy} data-testid="eval-conflict" onClick={() => setConflictOpen(true)}>I have a conflict</button>
        </div>
      )}
    </section>
  );

  return (
    <div className="min-w-0 space-y-3" data-testid="evaluation">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <button type="button" className={BTN} onClick={() => { void flush().then(onBack); }} data-testid="eval-back">← My evaluations</button>
        <span className="text-xs text-gray-500" role="status" aria-live="polite" data-testid="eval-save-state">{SAVE_TEXT[save]}</span>
      </div>
      <header className="min-w-0">
        <h2 className="text-lg font-semibold text-gray-900 [overflow-wrap:anywhere]" data-testid="eval-title">{title}</h2>
        <p className="text-xs text-gray-600 [overflow-wrap:anywhere]">{data.call.name}{data.application.submittedAt ? ` · submitted ${formatInZone(data.application.submittedAt, data.call.timezone)}` : ''}</p>
        {data.deadline && <p className={`mt-1 text-xs font-medium ${data.deadline.daysLeft <= 1 ? 'text-[#B00000]' : 'text-gray-700'}`} data-testid="eval-deadline">Deadline {formatDayInZone(`${data.deadline.day}T12:00:00Z`, data.call.timezone)} · {data.deadline.daysLeft < 0 ? 'passed' : data.deadline.daysLeft === 0 ? 'today' : data.deadline.daysLeft === 1 ? '1 day left' : `${data.deadline.daysLeft} days left`}</p>}
      </header>
      {error && <p role="alert" className="rounded bg-red-50 px-2 py-1.5 text-xs text-[#B00000]" data-testid="eval-error">{error}{save === 'conflict' && <> <button type="button" className="font-semibold underline" onClick={() => void load()}>Reload</button></>}</p>}
      {submitted && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="eval-submitted">Submitted{data.evaluation.submittedAt ? ` on ${formatInZone(data.evaluation.submittedAt, data.call.timezone)}` : ''}. It is read-only; only an administrator can reopen it.</p>}
      {data.call.closed && <p className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-800" data-testid="eval-closed">The evaluation is closed. Nothing can be changed.</p>}

      <div role="tablist" aria-label="Application or score" className="flex gap-1 border-b border-gray-200 lg:hidden">
        {(['application', 'score'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`eval-tab-${t}`} onClick={() => setTab(t)}
          className={`-mb-px min-h-[44px] border-b-2 px-4 py-2 text-sm ${tab === t ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600'}`}>{t === 'application' ? 'Application' : 'Score'}</button>)}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2 lg:items-start">
        <div className={`${tab === 'application' ? '' : 'hidden'} min-w-0 lg:block`}>{applicationPane}</div>
        <div className={`${tab === 'score' ? '' : 'hidden'} min-w-0 lg:sticky lg:top-2 lg:block lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto`}>{scorePane}</div>
      </div>
    </div>
  );
}

function CriterionScore({ c, entry, editable, need, forced, showComment, hover, onHover, onScore, onComment, onShowComment }: {
  c: Criterion; entry: { score: number | null; comment: string } | undefined; editable: boolean; need: 'score' | 'comment' | undefined; forced: boolean; showComment: boolean; hover: number | null;
  onHover: (level: number | null) => void; onScore: (score: number | null) => void; onComment: (c: string) => void; onShowComment: () => void;
}) {
  const score = entry?.score ?? null;
  const desc = levelDescription(c, hover ?? score ?? NaN);
  const open = showComment || forced || !!entry?.comment;
  return (
    <li className={`min-w-0 rounded-lg border bg-white p-3 ${need ? 'border-[#B00000]' : 'border-gray-200'}`} data-testid="eval-criterion" data-missing={need ?? undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{c.name}</p>
        <span className="shrink-0 text-xs text-gray-500">weight {c.weight} % · scale {scaleLabel(c)}</span>
      </div>
      {c.guidance && <p className="mt-1 text-xs text-gray-600 [overflow-wrap:anywhere]">{c.guidance}</p>}
      <div role="radiogroup" aria-label={`Score for ${c.name}`} className="mt-2 flex flex-wrap gap-1.5">
        {scaleLevels(c).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={score === l} disabled={!editable} data-testid="eval-level" onClick={() => onScore(score === l ? null : l)}
            onMouseEnter={() => onHover(l)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(l)} onBlur={() => onHover(null)}
            className={`min-h-[44px] min-w-[44px] rounded-lg border px-2 text-sm font-semibold disabled:opacity-60 ${score === l ? 'border-[#0E7490] bg-[#0E7490] text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}>{l}</button>
        ))}
      </div>
      {desc && <p className="mt-1.5 text-xs text-gray-700 [overflow-wrap:anywhere]" data-testid="eval-level-text">{desc}</p>}
      {need === 'score' && <p className="mt-1 text-xs font-medium text-[#B00000]">Choose a score for this criterion.</p>}
      {open ? (
        <div className="mt-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor={`cc-${c.id}`}>Comment{forced ? ' (required)' : ''}</label>
          <AutoTextarea id={`cc-${c.id}`} multiline className={INPUT} value={entry?.comment ?? ''} disabled={!editable} maxLength={2000} onChange={onComment} />
          {need === 'comment' && <p className="mt-1 text-xs font-medium text-[#B00000]">A comment is required for this criterion.</p>}
        </div>
      ) : editable && <button type="button" className="mt-1.5 min-h-[44px] text-xs font-medium text-[#0E7490] hover:underline sm:min-h-0" data-testid="eval-add-comment" onClick={onShowComment}>Add comment</button>}
    </li>
  );
}
