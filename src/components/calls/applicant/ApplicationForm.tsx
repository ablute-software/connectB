'use client';
// Prompt 907 (I2, I3) — the applicant's form: the call's questions page by page, saved as the applicant goes, then submitted.
//
// SAVING (spec §14.1). Every change schedules a save a moment later; "Next" and "Back" save first (and remember the page, so the link
// reopens where the applicant left off). The indicator says "Saving…", "Saved" or "Unsaved changes / save error" and NEVER says "Saved"
// before the server confirmed. A failed save (network, a conflict with another window, a closed call) keeps everything on screen and
// offers to try again. Saves go through ONE queue, each carrying the revision the server last confirmed.
//
// NAVIGATION. "Back" never erases the pages after it; the progress bar shows the page; there is no way back to the registration once the
// account exists. Conditions use the same shared logic as the entity's preview and the server (visiblePages), so a hidden required
// question never blocks.
//
// SUBMITTING (§14.2, §14.3). The last page has "Save" (stays a draft) and "Save & submit". Submitting first saves, then checks what is
// still missing and, if anything is, lists each question and its page in a popup; otherwise the server does the final check (call still
// open on ITS clock, confirmed account, required answers, uploads done, the limit per unit) and stores an immutable version. The request
// carries an idempotency key generated once per attempt: a double click or a retry never creates a second submission.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { visiblePages, validateAnswer, isAnswered } from '@/lib/calls/form-logic';
import { fileIdsInAnswers, fileValues, locateFile, maxFilesForTarget, removeFileFromAnswers, setFileInAnswers, subFieldAsField, type FileTarget } from '@/lib/calls/field-config';
import { finalCheck, visibleIds, type FinalIssue } from '@/lib/calls/preview-logic';
import type { Answers, AnswerValue, SimpleAnswer } from '@/lib/calls/types';
import { applicantApi, type SubmitFailure } from '@/lib/calls/applicant/client';
import { fileValue } from '@/lib/calls/applicant/answers';
import type { ApplicationState } from '@/lib/calls/applicant/store';
import { formatInZone } from '@/lib/calls/tz';
import { FieldInput } from '../FieldInput';
import { SaveStatus, type SaveState } from '../SaveStatus';
import { FileQuestion, type StateFile } from './FileQuestion';

const AUTOSAVE_MS = 1200;

export function ApplicationForm({ initial, initialPage, onSubmitted }: {
  initial: ApplicationState; initialPage: number; onSubmitted: (s: { submittedAt: string; reference: string | null }) => void;
}) {
  const appId = initial.application.id;
  const { fields } = initial;
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [files, setFiles] = useState<StateFile[]>(initial.files);
  const [page, setPage] = useState(initialPage);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [missing, setMissing] = useState<(FinalIssue | SubmitFailure)[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const canEdit = initial.canEdit && initial.application.status === 'draft';

  const answersRef = useRef(answers); answersRef.current = answers;
  const pageRef = useRef(page); pageRef.current = page;
  const revisionRef = useRef(initial.application.revision);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const submitKey = useRef<string | null>(null);
  // A double click lands twice in the same tick, before any state change is rendered: the guard is a ref, and the key is made BEFORE the first await.
  const submittingRef = useRef(false);
  const lastShown = useRef<Set<string> | null>(null);

  const pages = useMemo(() => visiblePages(fields, answers), [fields, answers]);
  const pageIndex = Math.min(Math.max(1, page), Math.max(1, pages.length));
  const current = pages[pageIndex - 1];
  const last = pageIndex >= pages.length;

  // ---- saving ---------------------------------------------------------------------------------------------------------------
  const runSave = useCallback(async (force: boolean): Promise<boolean> => {
    if (!canEdit) return true;
    if (!dirty.current && !force) return true;
    setSaveState('saving'); setSaveMessage('');
    const sent = answersRef.current;
    dirty.current = false;
    const r = await applicantApi.save(appId, { answers: sent, lastPage: pageRef.current, baseRevision: revisionRef.current });
    if (r.ok) {
      revisionRef.current = r.body.revision;
      // Never "Saved" while something newer is waiting.
      if (dirty.current) { setSaveState('dirty'); } else setSaveState('saved');
      return true;
    }
    dirty.current = true;
    if (r.body.code === 'conflict') { setSaveState('conflict'); setSaveMessage('changed in another window'); }
    else if (r.body.code === 'closed' || r.body.code === 'not_draft') { setSaveState('error'); setSaveMessage(r.body.error ?? ''); }
    else { setSaveState('error'); setSaveMessage(r.status === 0 ? 'no connection — what you typed is still here' : r.body.error ?? ''); }
    return false;
  }, [appId, canEdit]);

  const flush = useCallback((force = false): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = queue.current.then(() => runSave(force));
    queue.current = p.catch(() => false);
    return p;
  }, [runSave]);

  const touch = useCallback(() => {
    dirty.current = true;
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, AUTOSAVE_MS);
  }, [flush]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!canEdit) return;
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [canEdit]);

  function change(id: string, v: AnswerValue) {
    if (!canEdit) return;
    // An entry of a repeatable group that was removed takes its files with it: they leave the draft and the storage (the files route clears them everywhere).
    const before = new Set(fileIdsInAnswers(fields, answersRef.current));
    setAnswers((a) => ({ ...a, [id]: v }));
    answersRef.current = { ...answersRef.current, [id]: v };
    const after = new Set(fileIdsInAnswers(fields, answersRef.current));
    for (const fid of before) if (!after.has(fid)) { setFiles((all) => all.filter((x) => x.id !== fid)); void applicantApi.removeFile(appId, fid); }
    touch();
  }

  // ---- files ----------------------------------------------------------------------------------------------------------------
  // A file belongs to a question (and, inside a group, to one entry of it): where its answer goes is decided by the shared pure helpers.
  function attached(f: StateFile, target: FileTarget) {
    const single = maxFilesForTarget(fields, target) <= 1;
    // A question that takes one file: the new one replaces the old (same question, same entry). One that takes several: it is added.
    setFiles((all) => [...all.filter((x) => x.id !== f.id && !(single && x.fieldId === f.fieldId && (x.entryId ?? null) === (f.entryId ?? null))), f]);
    const next = setFileInAnswers(fields, answersRef.current, target, fileValue(f));
    answersRef.current = next; setAnswers(next);
    // The server must know the answer points at this file before anything else happens: save now, not on the timer.
    dirty.current = true; void flush(true);
  }
  function removed(fileId: string, revision?: number) {
    setFiles((all) => all.filter((x) => x.id !== fileId));
    const { answers: rest } = removeFileFromAnswers(fields, answersRef.current, fileId);
    answersRef.current = rest; setAnswers(rest);
    // The route already cleared it in the draft and moved the revision: carry it, so the next save is not taken for a conflict.
    if (typeof revision === 'number') revisionRef.current = revision;
  }
  function updated(f: StateFile) {
    setFiles((all) => all.map((x) => (x.id === f.id ? { ...f } : x)));
    // The same file, now at the new version: its answer entry is rebuilt wherever it is.
    const target = locateFile(fields, answersRef.current, f.id);
    if (target) { const next = setFileInAnswers(fields, answersRef.current, target, fileValue(f)); answersRef.current = next; setAnswers(next); }
  }

  // ---- navigation -----------------------------------------------------------------------------------------------------------
  async function goTo(n: number) {
    pageRef.current = n;
    await flush(true);
    setPage(n);
    window.scrollTo?.({ top: 0 });
  }

  // ---- submit ---------------------------------------------------------------------------------------------------------------
  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    // One key per attempt, made now and kept until the attempt is decided: a repeated click or a retry after a flaky network reuses it.
    if (!submitKey.current) submitKey.current = crypto.randomUUID();
    setSubmitError('');
    setSubmitting(true);
    try {
      const saved = await flush(true);
      if (!saved) { setSubmitError('We could not save your answers, so nothing was submitted. Try again.'); return; }
      // The WHOLE form, every page and group, in one list. The only thing a later check may add is a question that an answer given since made appear (marked as new).
      const issues = finalCheck(fields, answersRef.current, lastShown.current ?? undefined);
      lastShown.current = visibleIds(fields, answersRef.current);
      if (issues.length > 0) { setMissing(issues); return; }
      const r = await applicantApi.submit(appId, submitKey.current ?? crypto.randomUUID(), revisionRef.current);
      if (r.ok) { submitKey.current = null; onSubmitted({ submittedAt: r.body.submittedAt, reference: r.body.reference }); return; }
      if (r.status !== 0) submitKey.current = null; // a definitive answer: the next attempt is a new one
      if (r.body.failures && r.body.failures.length > 0) { setMissing(r.body.failures); return; }
      setSubmitError(r.body.error ?? 'We could not submit. Please try again.');
    } finally { setSubmitting(false); submittingRef.current = false; }
  }

  if (!current) return <p className="text-sm text-gray-500">This form has no questions.</p>;
  /** The files an answer points at (each shown with its own Remove): only THIS question's, and inside a group only THIS entry's. */
  const filesOf = (answer: AnswerValue | SimpleAnswer): StateFile[] => {
    const ids = new Set(fileValues(answer).map((v) => v.fileId));
    return files.filter((f) => ids.has(f.id));
  };

  return (
    <section data-testid="application-form" aria-label="Application">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">Application <b className="font-mono text-gray-700" data-testid="reference">{initial.application.reference}</b> · {initial.call.promoter}</p>
        {canEdit && <SaveStatus state={saveState} message={saveMessage} onRetry={() => void flush(true)} onReload={() => window.location.reload()} />}
      </div>
      <div className="mb-5 flex items-center gap-2" aria-label={`Page ${pageIndex} of ${pages.length}`}>
        <div className="h-1.5 flex-1 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-[#0E7490] transition-all" style={{ width: `${(pageIndex / pages.length) * 100}%` }} /></div>
        <span className="text-xs text-gray-500" data-testid="page-indicator">Page {pageIndex} of {pages.length}</span>
      </div>
      {initial.application.status === 'submitted' && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status" data-testid="submitted-note">
          Submitted{initial.application.submittedAt ? ` on ${formatInZone(initial.application.submittedAt, initial.call.timezone)}` : ''}. This is a read-only copy: nothing can be changed any more.
        </p>
      )}
      {!canEdit && initial.application.status === 'draft' && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" data-testid="read-only-note">
          This call is no longer accepting applications, so this draft can only be read.
        </p>
      )}
      <div className="space-y-5">
        {current.fields.map((f) => {
          const v = answers[f.id];
          // only what was typed; "required" is checked at submission. A table shows its problems cell by cell, so it has no message of its own under the whole question.
          const err = canEdit && f.kind !== 'table' && isAnswered(v) ? validateAnswer(f, v) : null;
          return (
            <FieldInput key={f.id} field={f} value={v} error={err ?? undefined} currency={initial.call.currency} disabled={!canEdit} onChange={(nv) => change(f.id, nv)}
              fileControl={f.kind === 'file' ? (
                <FileQuestion field={f} applicationId={appId} orgId={initial.orgId} files={filesOf(v)} disabled={!canEdit}
                  onAttached={(file) => attached(file, { questionId: f.id })} onRemoved={removed} onUpdated={updated} />
              ) : undefined}
              fileControlFor={f.kind === 'group' ? (sub, entryId, entryValue) => (
                <FileQuestion field={subFieldAsField(sub)} entryId={entryId} applicationId={appId} orgId={initial.orgId} files={filesOf(entryValue)} disabled={!canEdit}
                  onAttached={(file) => attached(file, { questionId: sub.id, groupId: f.id, entryId })} onRemoved={removed} onUpdated={updated} />
              ) : undefined} />
          );
        })}
      </div>
      {submitError && <p role="alert" className="mt-4 text-sm text-[#B00000]" data-testid="submit-error">{submitError}</p>}
      <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
        <button type="button" disabled={pageIndex === 1 || submitting} onClick={() => void goTo(pageIndex - 1)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40" data-testid="back">Back</button>
        {last ? (
          canEdit ? (
            <span className="flex items-center gap-2">
              <button type="button" disabled={submitting} onClick={() => void flush(true)} data-testid="save"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Save</button>
              <button type="button" disabled={submitting} onClick={() => void submit()} data-testid="save-and-submit"
                className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">{submitting ? 'Submitting…' : 'Save & submit'}</button>
            </span>
          ) : null
        ) : (
          <button type="button" disabled={submitting} onClick={() => void goTo(pageIndex + 1)} data-testid="next"
            className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">Next</button>
        )}
      </div>
      {canEdit && <p className="mt-3 text-[11px] text-gray-400">Deadline: {formatInZone(initial.call.closesAt, initial.call.timezone)}. Your answers are saved as you go; nothing is sent to {initial.call.promoter} until you submit.</p>}
      {missing && <MissingPopup items={missing} onClose={() => setMissing(null)} onGo={(n) => { setMissing(null); void goTo(n); }} />}
    </section>
  );
}

/** "Something is missing": every question and the page it is on (spec §14.2). A portal, because it covers the viewport. */
function MissingPopup({ items, onClose, onGo }: { items: (FinalIssue | SubmitFailure)[]; onClose: () => void; onGo: (pageNumber: number) => void }) {
  if (typeof document === 'undefined') return null;
  const num = (i: FinalIssue | SubmitFailure) => ('pageNumber' in i ? i.pageNumber : i.page);
  const newBecause = (i: FinalIssue | SubmitFailure) => ('newBecause' in i ? i.newBecause : undefined);
  const keyOf = (i: FinalIssue | SubmitFailure, n: number) => ('key' in i && i.key ? i.key : `${i.fieldId}:${n}`);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="What is missing" data-testid="missing-popup">
      <div className="max-h-[80vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-gray-900">{items.length === 1 ? 'One thing is missing' : `${items.length} things are missing`}</h2>
        <p className="mt-1 text-sm text-gray-500">Your answers are saved. Complete these to submit:</p>
        <ul className="mt-3 space-y-1.5 text-sm" data-testid="missing-list">
          {items.map((i, n) => (
            <li key={keyOf(i, n)} className="flex items-start justify-between gap-3 rounded-lg bg-red-50 px-3 py-2">
              <span className="text-gray-800"><b>Page {num(i)}</b> · {i.label}<span className="block text-xs text-[#B00000]">{i.message}</span>{newBecause(i) && <span className="block text-xs font-medium text-amber-700" data-testid="new-because">New: shown because you answered «{newBecause(i)!.label}» on page {newBecause(i)!.pageNumber}</span>}</span>
              <button type="button" onClick={() => onGo(num(i))} className="shrink-0 text-xs font-semibold text-[#0E7490] hover:underline">Go to the page</button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50" data-testid="missing-close">Close</button>
      </div>
    </div>,
    document.body,
  );
}
