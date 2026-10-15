'use client';
// Prompt 909 (I4) — "Import from documents": upload the organisation's OWN documents, read the proposal, and accept,
// edit or discard each item. Three steps in one dialog:
//   1. Upload: the formats and limits written out, the privacy notice shown BEFORE anything is sent, a kind per file.
//   1b. Reading (Adenda 2): the model works in the background; this step polls the run and says it can take up to two minutes. Closing the
//      dialog does not stop it, and opening it again resumes the wait (or shows the proposal that is ready, or why it failed).
//   2. Review: what may be out of date and what the form cannot express (said exactly), then General, Phases and
//      the Form, every item with Accept / Edit / Discard and "Accept all" per section. What is found for later
//      stages (eligibility, evaluation) is shown as plain text, not configured. NOTHING reaches the call's
//      configuration except what is Accepted, when "Apply" is pressed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Proposal, ProposalFieldItem, ProposalGeneral, ProposalPhaseItem } from '@/lib/calls/ai-import/proposal';
import {
  IMPORT_ACCEPT, IMPORT_FORMATS_TEXT, IMPORT_MAX_FILES, IMPORT_PRIVACY_NOTICE, SOURCE_KINDS, SOURCE_KIND_LABELS, type SourceKind,
} from '@/lib/calls/ai-import/limits';
import { AI_FIELD_KINDS, FIELD_KIND_LABELS, isChoiceKind, type FieldKind } from '@/lib/calls/types';
import { formatInZone, utcToWall, wallToUtcIso } from '@/lib/calls/tz';
import { splitContact } from '@/lib/calls/ai-import/client-errors';
import { IMPORT_NOTICES_EVENT, afterPoll, onOpen } from '@/lib/calls/ai-import/screen-state';
import { callsApi } from './api';

const POLL_MS = 3000;

/** A sentence that may end with the contact address: that part is a link. */
function Sentence({ text }: { text: string }) {
  const parts = splitContact(text);
  if (!parts) return <>{text}</>;
  return <>{parts.before}<a href="/contact" target="_blank" rel="noopener noreferrer" className="underline">sherlockdeal.com/contact</a>{parts.after}</>;
}

type Decision = 'accepted' | 'discarded';
export interface ApplyOutcome { ok: boolean; error?: string; summary?: string }
const BTN = 'rounded-lg border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';
const INPUT = 'rounded-lg border border-gray-300 px-2 py-1 text-xs';

export function ImportFromDocuments({ callId, timezone, currentFieldCount, onClose, onApply }: {
  callId: string; timezone: string; currentFieldCount: number; onClose: () => void;
  onApply: (runId: string, accepted: { general?: ProposalGeneral; phases?: ProposalPhaseItem[]; fields?: ProposalFieldItem[] }, fieldsMode: 'add' | 'replace') => Promise<ApplyOutcome>;
}) {
  const [step, setStep] = useState<'upload' | 'reading' | 'review'>('upload');
  const [files, setFiles] = useState<{ file: File; kind: SourceKind }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [readingRunId, setReadingRunId] = useState<string | null>(null);
  const [readingSince, setReadingSince] = useState<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const [waiting, setWaiting] = useState<{ id: string; proposal: Proposal } | null>(null);
  const alive = useRef(true);
  const [run, setRun] = useState<{ id: string; proposal: Proposal } | null>(null);

  // Review state: a decision per item, and the item as edited.
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [edited, setEdited] = useState<{ general: ProposalGeneral; phases: ProposalPhaseItem[]; fields: ProposalFieldItem[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [fieldsMode, setFieldsMode] = useState<'add' | 'replace'>('add');

  function openReview(id: string, proposal: Proposal) {
    setRun({ id, proposal });
    setEdited({ general: { ...proposal.general }, phases: proposal.phases.map((p) => ({ ...p })), fields: proposal.fields.map((f) => ({ ...f, options: [...f.options] })) });
    setWaiting(null); setStep('review');
  }
  function startWaiting(runId: string, since: number) { setReadingRunId(runId); setReadingSince(since); setElapsed(Math.max(0, Math.round((Date.now() - since) / 1000))); setStep('reading'); }

  // On open: a reading still in progress resumes its wait; a proposal that is ready is offered; a failure that happened while the dialog was closed is said.
  useEffect(() => {
    alive.current = true;
    void (async () => {
      const r = await callsApi.importState(callId);
      if (!alive.current || !r.ok) return;
      // Opening the screen is seeing the notices of this call: they are not needed any more.
      void callsApi.markImportNoticesSeen({ callId }).then(() => window.dispatchEvent(new Event(IMPORT_NOTICES_EVENT)));
      const d = onOpen(r.body);
      if (d.kind === 'reading') { startWaiting(d.runId, d.since); return; }
      setWaiting(d.waiting);
      if (d.error) setError(d.error);
    })();
    return () => { alive.current = false; };
  }, [callId]);

  // While reading: ask the run, every few seconds, until it is no longer reading.
  useEffect(() => {
    if (step !== 'reading' || !readingRunId) return;
    let misses = 0; let stopped = false;
    const tick = async () => {
      const r = await callsApi.importRun(callId, readingRunId);
      if (stopped || !alive.current) return;
      setElapsed(Math.max(0, Math.round((Date.now() - readingSince) / 1000)));
      const next = afterPoll({ ok: r.ok, status: r.status, run: r.body?.run }, misses);
      if (next.kind === 'wait') { misses = next.misses; return; }
      if (next.kind === 'review') { openReview(next.id, next.proposal); return; }
      setError(next.error); setStep('upload');
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, readingRunId, callId, readingSince]);

  async function send() {
    setBusy(true); setError(''); setHttpStatus(null);
    const form = new FormData();
    for (const f of files) { form.append('files', f.file); form.append('kinds', f.kind); }
    const r = await callsApi.importFromDocuments(callId, form);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 409 && r.body.code === 'busy' && r.body.runId) { startWaiting(r.body.runId, Date.now()); return; }
      setError(r.body.error ?? ''); setHttpStatus(r.httpStatus); return;
    }
    startWaiting(r.body.run.id, Date.now());
  }

  const generalKeys = useMemo(() => (edited ? (Object.keys(edited.general) as (keyof ProposalGeneral)[]) : []), [edited]);
  const decide = (key: string, d: Decision | undefined) => setDecisions((s) => { const n = { ...s }; if (d) n[key] = d; else delete n[key]; return n; });
  const acceptAll = (keys: string[]) => setDecisions((s) => { const n = { ...s }; for (const k of keys) if (n[k] !== 'discarded') n[k] = 'accepted'; return n; });

  const keysGeneral = generalKeys.map((k) => `g:${k}`);
  const keysPhases = (edited?.phases ?? []).map((_, i) => `p:${i}`);
  const keysFields = (edited?.fields ?? []).map((f) => `f:${f.tmpId}`);
  const acceptedCount = [...keysGeneral, ...keysPhases, ...keysFields].filter((k) => decisions[k] === 'accepted').length;

  async function apply() {
    if (!run || !edited) return;
    setBusy(true); setError('');
    const general: ProposalGeneral = {};
    for (const k of generalKeys) if (decisions[`g:${k}`] === 'accepted') (general as Record<string, unknown>)[k] = edited.general[k];
    const phases = edited.phases.filter((_, i) => decisions[`p:${i}`] === 'accepted');
    const fields = edited.fields.filter((f) => decisions[`f:${f.tmpId}`] === 'accepted');
    const res = await onApply(run.id, { general: Object.keys(general).length ? general : undefined, phases: phases.length ? phases : undefined, fields: fields.length ? fields : undefined }, fieldsMode);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Could not apply the accepted items.'); return; }
    onClose();
  }
  async function discard() {
    if (run) await callsApi.discardImport(callId, run.id);
    onClose();
  }

  if (typeof document === 'undefined') return null;
  const p = run?.proposal;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Import from documents" data-testid="import-docs-dialog">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-bold text-gray-900">{step === 'upload' ? 'Import from documents' : 'Review the proposal'}</h2>
          <button type="button" onClick={step === 'review' ? () => void discard() : onClose} className="text-sm text-gray-500 hover:text-gray-800" aria-label="Close">✕</button>
        </div>

        {step === 'upload' && (
          <div className="space-y-4 overflow-y-auto p-5" data-testid="import-docs-upload">
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="privacy-notice">{IMPORT_PRIVACY_NOTICE}</p>
            <p className="text-xs text-gray-600" data-testid="import-formats">{IMPORT_FORMATS_TEXT}</p>
            <div>
              <label className="text-xs font-semibold text-gray-700" htmlFor="import-files">Regulation and/or a previous form</label>
              <input id="import-files" type="file" multiple accept={IMPORT_ACCEPT} className="mt-1 block text-sm" data-testid="import-files"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, IMPORT_MAX_FILES).map((file) => ({ file, kind: guessKind(file.name) })))} />
            </div>
            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li key={`${f.file.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                    <span>{f.file.name} <span className="text-gray-400">· {(f.file.size / 1024).toFixed(0)} KB</span></span>
                    <select aria-label={`What is ${f.file.name}`} value={f.kind} className={INPUT} onChange={(e) => setFiles((s) => s.map((x, j) => (j === i ? { ...x, kind: e.target.value as SourceKind } : x)))}>
                      {SOURCE_KINDS.map((k) => <option key={k} value={k}>{SOURCE_KIND_LABELS[k]}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            )}
            {waiting && (
              <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="import-waiting-proposal">
                A proposal from an earlier reading is waiting for your review.
                <span className="ml-3 inline-flex gap-3">
                  <button type="button" className="font-semibold underline" onClick={() => openReview(waiting.id, waiting.proposal)} data-testid="import-review-waiting">Review it</button>
                  <button type="button" className="text-emerald-800 underline" onClick={async () => { await callsApi.discardImport(callId, waiting.id); setWaiting(null); }}>Discard it</button>
                </span>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-[#B00000]" data-testid="import-docs-error">
                <Sentence text={error} />
                {httpStatus !== null && <span className="ml-1 text-[10px] text-gray-400" data-testid="import-http-code">(HTTP {httpStatus})</span>}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" disabled={files.length === 0 || busy} onClick={() => void send()} data-testid="import-docs-send"
                className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">{busy ? 'Sending…' : 'Read the documents and propose'}</button>
            </div>
          </div>
        )}

        {step === 'reading' && (
          <div className="space-y-4 p-8 text-center" data-testid="import-docs-reading" role="status" aria-live="polite">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#0E7490]" aria-hidden="true" />
            <p className="text-sm text-gray-800" data-testid="reading-text">Reading your documents. This can take a minute or two. You can keep using the platform; we&apos;ll let you know when the proposal is ready.</p>
            <p className="text-[11px] text-gray-400" data-testid="reading-elapsed">{elapsed}s</p>
            <button type="button" onClick={onClose} data-testid="continue-working" className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b]">Continue working</button>
          </div>
        )}

        {step === 'review' && p && edited && (
          <>
            <div className="space-y-6 overflow-y-auto p-5" data-testid="import-docs-review">
              <p className="text-xs text-gray-500">This is a <b>proposal</b>. Nothing is saved until you accept items and press Apply. Anything you accept can still be edited afterwards.</p>

              {p.attention.length > 0 && (
                <section aria-label="Needs your attention" data-testid="attention">
                  <h3 className="text-sm font-semibold text-gray-900">Needs your attention</h3>
                  <ul className="mt-2 space-y-1.5">
                    {p.attention.map((a, i) => (
                      <li key={i} className={`rounded-lg px-3 py-2 text-xs ${a.kind === 'outdated' ? 'bg-amber-50 text-amber-900' : 'bg-sky-50 text-sky-900'}`}>
                        <b>{a.kind === 'outdated' ? 'Possibly out of date' : 'Not covered by the form'}:</b> {a.what}{a.why && <span className="block opacity-80">{a.why}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Section title="General" keys={keysGeneral} decisions={decisions} onAcceptAll={() => acceptAll(keysGeneral)} empty="The documents did not say anything for this section.">
                {generalKeys.map((k) => (
                  <Item key={k} id={`g:${k}`} decisions={decisions} decide={decide} editing={editing} setEditing={setEditing}
                    view={<><span className="text-gray-500">{GENERAL_LABEL[k]}:</span> {generalText(k, edited.general, timezone)}</>}
                    edit={<GeneralEditor k={k} value={edited.general} timezone={edited.general.timezone ?? timezone} onChange={(v) => setEdited({ ...edited, general: v })} />} />
                ))}
              </Section>

              <Section title="Phases" keys={keysPhases} decisions={decisions} onAcceptAll={() => acceptAll(keysPhases)} empty="No phases found.">
                {edited.phases.map((ph, i) => (
                  <Item key={i} id={`p:${i}`} decisions={decisions} decide={decide} editing={editing} setEditing={setEditing}
                    view={<><b>{ph.name}</b>{(ph.startsOn || ph.endsOn) && <span className="text-gray-500"> · {ph.startsOn ?? '…'} → {ph.endsOn ?? '…'}</span>}</>}
                    edit={(
                      <span className="flex flex-wrap gap-2">
                        <input aria-label="Phase name" autoComplete="off" className={INPUT} value={ph.name} onChange={(e) => setEdited({ ...edited, phases: edited.phases.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                        <input autoComplete="off" aria-label="Starts" type="date" className={INPUT} value={ph.startsOn ?? ''} onChange={(e) => setEdited({ ...edited, phases: edited.phases.map((x, j) => (j === i ? { ...x, startsOn: e.target.value || null } : x)) })} />
                        <input autoComplete="off" aria-label="Ends" type="date" className={INPUT} value={ph.endsOn ?? ''} onChange={(e) => setEdited({ ...edited, phases: edited.phases.map((x, j) => (j === i ? { ...x, endsOn: e.target.value || null } : x)) })} />
                      </span>
                    )} />
                ))}
              </Section>

              <Section title="Form" keys={keysFields} decisions={decisions} onAcceptAll={() => acceptAll(keysFields)} empty="No questions found.">
                {edited.fields.map((f, i) => (
                  <Item key={f.tmpId} id={`f:${f.tmpId}`} decisions={decisions} decide={decide} editing={editing} setEditing={setEditing}
                    view={(
                      <>
                        <span className="mr-1.5 text-[10px] uppercase text-gray-400">Page {f.page}</span><b>{f.label}</b>
                        <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] text-gray-600">{FIELD_KIND_LABELS[f.kind]}{f.required ? ' · required' : ''}</span>
                        {f.options.length > 0 && <span className="block text-gray-500">Options: {f.options.join(', ')}</span>}
                        {f.kind === 'file' && f.expectedType && <span className="block text-gray-500">Expected document: {f.expectedType}{f.maxAgeMonths ? ` (up to ${f.maxAgeMonths} months old)` : ''}</span>}
                        {f.instruction && <span className="block text-gray-500">{f.instruction}</span>}
                      </>
                    )}
                    edit={<FieldEditor f={f} onChange={(next) => setEdited({ ...edited, fields: edited.fields.map((x, j) => (j === i ? next : x)) })} />} />
                ))}
              </Section>

              {(p.foundLater.eligibility.length > 0 || p.foundLater.evaluation.length > 0) && (
                <section aria-label="Found for later stages" data-testid="found-later">
                  <h3 className="text-sm font-semibold text-gray-900">Found in the document, configured in a later stage</h3>
                  <p className="mt-0.5 text-[11px] text-gray-500">Kept as text for the next stages; nothing is configured from it now.</p>
                  {p.foundLater.eligibility.length > 0 && <FoundList title="Eligibility rules" items={p.foundLater.eligibility} />}
                  {p.foundLater.evaluation.length > 0 && <FoundList title="Evaluation criteria" items={p.foundLater.evaluation} />}
                </section>
              )}
            </div>
            <div className="border-t border-gray-200 px-5 py-3">
              {currentFieldCount > 0 && keysFields.some((k) => decisions[k] === 'accepted') && (
                <fieldset className="mb-2 flex flex-wrap items-center gap-4 text-xs" aria-label="Where the questions go">
                  <label className="flex items-center gap-1.5"><input type="radio" name="fields-mode" checked={fieldsMode === 'add'} onChange={() => setFieldsMode('add')} /> Add after the current form</label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="fields-mode" checked={fieldsMode === 'replace'} onChange={() => setFieldsMode('replace')} /> Replace the current form</label>
                </fieldset>
              )}
              {error && <p role="alert" className="mb-2 text-xs text-[#B00000]" data-testid="import-docs-error">{error}</p>}
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => void discard()} className="text-sm text-gray-500 hover:underline">Discard proposal</button>
                <button type="button" disabled={acceptedCount === 0 || busy} onClick={() => void apply()} data-testid="import-docs-apply"
                  className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                  {busy ? 'Applying…' : acceptedCount === 0 ? 'Accept items to apply them' : `Apply ${acceptedCount} accepted item${acceptedCount === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

const guessKind = (name: string): SourceKind => (/form|application/i.test(name) ? 'form' : /regulation|rules|call|regulamento/i.test(name) ? 'regulation' : 'other');

const GENERAL_LABEL: Record<keyof ProposalGeneral, string> = {
  name: 'Name', description: 'Description', opensAt: 'Opens', closesAt: 'Closes', timezone: 'Time zone', limitUnit: 'Application limit',
};
function generalText(k: keyof ProposalGeneral, g: ProposalGeneral, tz: string): string {
  const v = g[k];
  if (k === 'opensAt' || k === 'closesAt') return formatInZone(v as string, g.timezone ?? tz);
  if (k === 'limitUnit') return v === 'legal_entity' ? 'One per legal entity' : 'One per project';
  return String(v ?? '');
}

function Section({ title, keys, decisions, onAcceptAll, empty, children }: {
  title: string; keys: string[]; decisions: Record<string, Decision>; onAcceptAll: () => void; empty: string; children: React.ReactNode;
}) {
  const pending = keys.filter((k) => decisions[k] !== 'accepted' && decisions[k] !== 'discarded').length;
  return (
    <section aria-label={title} data-testid={`section-${title}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {keys.length > 0 && <button type="button" className={BTN} disabled={pending === 0} onClick={onAcceptAll} data-testid={`accept-all-${title}`}>Accept all</button>}
      </div>
      {keys.length === 0 ? <p className="mt-1 text-xs text-gray-400">{empty}</p> : <ul className="mt-2 space-y-1.5">{children}</ul>}
    </section>
  );
}

function Item({ id, decisions, decide, editing, setEditing, view, edit }: {
  id: string; decisions: Record<string, Decision>; decide: (k: string, d: Decision | undefined) => void;
  editing: string | null; setEditing: (k: string | null) => void; view: React.ReactNode; edit: React.ReactNode;
}) {
  const d = decisions[id];
  const isEditing = editing === id;
  return (
    <li className={`rounded-lg border px-3 py-2 text-xs ${d === 'accepted' ? 'border-emerald-300 bg-emerald-50' : d === 'discarded' ? 'border-gray-200 bg-gray-50 text-gray-400 line-through' : 'border-gray-200'}`} data-testid={`item-${id}`} data-decision={d ?? 'pending'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{isEditing ? edit : view}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {d === 'accepted' && <span className="text-[10px] font-semibold uppercase text-emerald-700">Accepted</span>}
          {d === 'discarded' && <span className="text-[10px] font-semibold uppercase text-gray-500 no-underline">Discarded</span>}
          <button type="button" className={BTN} onClick={() => { decide(id, d === 'accepted' ? undefined : 'accepted'); setEditing(null); }} data-testid={`accept-${id}`}>{d === 'accepted' ? 'Undo' : 'Accept'}</button>
          <button type="button" className={BTN} onClick={() => setEditing(isEditing ? null : id)} data-testid={`edit-${id}`}>{isEditing ? 'Done' : 'Edit'}</button>
          <button type="button" className={BTN} onClick={() => { decide(id, d === 'discarded' ? undefined : 'discarded'); setEditing(null); }} data-testid={`discard-${id}`}>{d === 'discarded' ? 'Undo' : 'Discard'}</button>
        </div>
      </div>
    </li>
  );
}

function GeneralEditor({ k, value, timezone, onChange }: { k: keyof ProposalGeneral; value: ProposalGeneral; timezone: string; onChange: (v: ProposalGeneral) => void }) {
  if (k === 'opensAt' || k === 'closesAt') {
    return <input autoComplete="off" type="datetime-local" aria-label={GENERAL_LABEL[k]} className={INPUT} value={utcToWall(value[k], timezone)}
      onChange={(e) => { const iso = e.target.value ? wallToUtcIso(e.target.value, timezone) : null; if (iso) onChange({ ...value, [k]: iso }); }} />;
  }
  if (k === 'limitUnit') {
    return <select aria-label="Application limit" className={INPUT} value={value.limitUnit} onChange={(e) => onChange({ ...value, limitUnit: e.target.value as 'project' | 'legal_entity' })}>
      <option value="project">One per project</option><option value="legal_entity">One per legal entity</option></select>;
  }
  return k === 'description'
    ? <textarea autoComplete="off" aria-label="Description" className={`${INPUT} w-full`} rows={3} value={value.description ?? ''} onChange={(e) => onChange({ ...value, description: e.target.value })} />
    : <input autoComplete="off" aria-label={GENERAL_LABEL[k]} className={`${INPUT} w-full`} value={String(value[k] ?? '')} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />;
}

function FieldEditor({ f, onChange }: { f: ProposalFieldItem; onChange: (f: ProposalFieldItem) => void }) {
  return (
    <span className="grid gap-1.5">
      <input autoComplete="off" aria-label="Question" className={`${INPUT} w-full`} value={f.label} onChange={(e) => onChange({ ...f, label: e.target.value })} />
      <span className="flex flex-wrap items-center gap-2">
        <select aria-label="Kind" className={INPUT} value={f.kind} onChange={(e) => onChange({ ...f, kind: e.target.value as FieldKind })}>
          {AI_FIELD_KINDS.map((k) => <option key={k} value={k}>{FIELD_KIND_LABELS[k]}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={f.required} onChange={(e) => onChange({ ...f, required: e.target.checked })} /> Required</label>
      </span>
      {isChoiceKind(f.kind) && <textarea autoComplete="off" aria-label="Options, one per line" className={`${INPUT} w-full`} rows={3} value={f.options.join('\n')} onChange={(e) => onChange({ ...f, options: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />}
      {f.kind === 'file' && <input autoComplete="off" aria-label="Expected document" className={`${INPUT} w-full`} placeholder="Expected document" value={f.expectedType ?? ''} onChange={(e) => onChange({ ...f, expectedType: e.target.value || null })} />}
      <input autoComplete="off" aria-label="Instruction" className={`${INPUT} w-full`} placeholder="Instruction for the applicant (optional)" value={f.instruction ?? ''} onChange={(e) => onChange({ ...f, instruction: e.target.value || null })} />
    </span>
  );
}

function FoundList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-700">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}
