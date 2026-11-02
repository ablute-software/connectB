'use client';
// Prompt 907 (I4) — "Submissions", read-only, in the editor of a call (spec §14.4, §20): the SUBMITTED applications — startup, reference, when —
// and, for each, the version exactly as it was submitted (answers, documents, the form as it was). Drafts never appear here, not even as a count:
// the entity sees only what was submitted. Prompt 918 (I3): each application shows its ELIGIBILITY (Fit / Not a fit / To validate, or still being checked), the list has those sub-views, and the detail
// shows the result rule by rule with the evidence, the possible duplicates and — for whoever may — the corrections. Evaluation and distribution come in a later stage.
import { useCallback, useEffect, useState } from 'react';
import { formatInZone } from '@/lib/calls/tz';
import { answerText } from '@/lib/calls/answer-text';
import { visiblePages } from '@/lib/calls/form-logic';
import { entriesOf, fileValues, groupOf, isHttpUrl, presetEntriesFor, subFieldAsField } from '@/lib/calls/field-config';
import { isTableAnswered } from '@/lib/calls/table';
import type { Answers, AnswerValue, FormField, SimpleAnswer } from '@/lib/calls/types';
import { TableInput } from './TableInput';
import { ApplicationEligibility } from './ApplicationEligibility';
import { ELIGIBILITY_LABEL, type EligibilityInfo, type EligibilityState, type EligibilityView } from '@/lib/calls/eligibility-payload';
import { duplicateSentence, type PossibleDuplicate } from '@/lib/calls/duplicates';
import { DocViewerProvider, useDocViewer } from './DocViewer';

interface Item { applicationId: string; reference: string | null; startup: string; submittedAt: string; eligibility?: { state: EligibilityState; view: EligibilityView; reason: string; source: string | null }; duplicates?: number }
interface Detail {
  applicationId?: string; eligibility?: EligibilityInfo | null; duplicates?: PossibleDuplicate[]; canCorrect?: boolean; canFlag?: boolean;
  reference: string | null; startup: string; submittedAt: string; version: number; fields: FormField[]; answers: Answers;
  documents: { fileId: string; fieldId: string; fileName: string; size: number; source: string; versionNumber: number | null; url: string }[];
}

const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export { answerText } from '@/lib/calls/answer-text';

type Doc = Detail['documents'][number];

/** One answer as the entity reads it: option labels, files as downloads, a link that opens in a NEW tab (never embedded, never previewed), a group as its entries. */
export function AnswerView({ field, value, docs, currency }: { field: FormField; value: AnswerValue | SimpleAnswer; docs: Doc[]; currency: string }) {
  // Inside a viewer (Prompt 930) a document opens in the platform; without one it stays a plain link to the platform's own route.
  const openDoc = useDocViewer();
  if (field.kind === 'file') {
    const refs = fileValues(value);
    if (refs.length === 0) return <>—</>;
    return (
      <ul className="space-y-0.5" data-testid="answer-files">
        {refs.map((r, i) => {
          const doc = docs.find((d) => d.fileId === r.fileId);
          return (
            <li key={r.fileId ?? i}>
              {doc ? (openDoc
                ? <button type="button" className="text-left font-medium text-[#0E7490] hover:underline [overflow-wrap:anywhere]" data-testid="open-document" onClick={() => openDoc(doc.fileId)}>{doc.fileName}</button>
                : <a href={doc.url} className="font-medium text-[#0E7490] hover:underline" target="_blank" rel="noreferrer">{doc.fileName}</a>) : r.fileName}
              <span className="ml-2 text-xs text-gray-400">{sizeText(doc?.size ?? r.size)}{doc?.source === 'vault' ? ` · from the Vault (v${doc.versionNumber ?? 1})` : ''}</span>
            </li>
          );
        })}
      </ul>
    );
  }
  if (field.kind === 'url') {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url) return <>—</>;
    // Only an http(s) link becomes a link; anything else is shown as plain text. It opens in a new tab, without the opener or the referrer.
    return isHttpUrl(url) ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-[#0E7490] hover:underline" data-testid="answer-link">{url}</a> : <span className="break-all">{url}</span>;
  }
  // A table: the whole grid, read-only, with the applicant's own columns and rows marked "added by applicant" and "Expand table" for a big one (Prompt 917, Adenda 2, B3).
  if (field.kind === 'table') return isTableAnswered(value as AnswerValue) ? <TableInput field={field} value={value as AnswerValue} currency={currency} disabled markAdded onChange={() => {}} /> : <>—</>;
  if (field.kind === 'group') {
    const g = groupOf(field);
    // Nothing answered stays "—"; once there is an answer, the rows the entity fixed are shown with their first columns, even for an answer stored before they were kept.
    const stored = entriesOf(value as AnswerValue);
    const entries = g && stored.length > 0 ? presetEntriesFor(g, value as AnswerValue) : stored;
    if (!g || entries.length === 0) return <>—</>;
    const cells = (e: (typeof entries)[number]) => g.subFields.map((s) => <AnswerView key={s.id} field={subFieldAsField(s)} value={e.values[s.id]} docs={docs} currency={currency} />);
    if (g.display === 'table') {
      return (
        <div className="overflow-x-auto" data-testid="answer-group-table">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs text-gray-500"><tr>{g.subFields.map((s) => <th key={s.id} className="py-1 pr-4 font-medium">{s.label}</th>)}</tr></thead>
            <tbody>{entries.map((e) => <tr key={e.id} className="border-t border-gray-100 align-top">{cells(e).map((c, i) => <td key={i} className="py-1 pr-4">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    return (
      <ol className="space-y-2" data-testid="answer-group-cards">
        {entries.map((e, i) => (
          <li key={e.id} className="rounded border border-gray-200 px-3 py-2">
            <p className="text-xs font-semibold text-gray-500">{g.entryLabel} {i + 1}</p>
            <dl className="mt-1 space-y-0.5">{g.subFields.map((s) => (
              <div key={s.id} className="grid gap-1 sm:grid-cols-[10rem_1fr]"><dt className="text-xs text-gray-500">{s.label}</dt><dd className="text-sm"><AnswerView field={subFieldAsField(s)} value={e.values[s.id]} docs={docs} currency={currency} /></dd></div>
            ))}</dl>
          </li>
        ))}
      </ol>
    );
  }
  return <>{answerText(field, value as AnswerValue, currency)}</>;
}

/** The filters of the list of applications (Prompt 930, B): the result, and "Changed by a person" (decided or flagged by someone, not left to the automatic check). */
export type ListFilter = EligibilityView | 'all' | 'changed';
const FILTERS: { key: ListFilter; label: string; param: string }[] = [
  { key: 'all', label: 'All', param: 'all' }, { key: 'fit', label: 'Fit', param: 'fit' }, { key: 'not_fit', label: 'Not a fit', param: 'not_fit' }, { key: 'to_validate', label: 'To validate', param: 'to_validate' },
  { key: 'processing', label: 'Processing', param: 'processing' }, { key: 'changed', label: 'Changed by a person', param: 'changed' },
];
export const isFilter = (v: unknown): v is ListFilter => FILTERS.some((f) => f.key === v);
const STATE_TONE: Record<EligibilityState, string> = { fit: 'bg-emerald-50 text-emerald-900', not_fit: 'bg-red-50 text-[#8a0000]', to_validate: 'bg-amber-50 text-amber-900', queued: 'bg-gray-100 text-gray-700', processing: 'bg-gray-100 text-gray-700', technical_failure: 'bg-red-50 text-[#8a0000]' };

/** The applications of one sub-view. An application with no eligibility information (an old server answer) is shown in "All" only. */
export const changedByAPerson = (s: Pick<Item, 'eligibility'>): boolean => s.eligibility?.source === 'human' || s.eligibility?.source === 'flag';
export const shown = (items: Item[], view: ListFilter): Item[] => (view === 'all' ? items : view === 'changed' ? items.filter(changedByAPerson) : items.filter((s) => s.eligibility?.view === view));
/** "All (24) · Fit (15) · Not a fit (6) · To validate (3)": the counts of every filter, from the list itself. */
export const filterCounts = (items: Item[]): Record<ListFilter, number> => ({ all: items.length, fit: shown(items, 'fit').length, not_fit: shown(items, 'not_fit').length, to_validate: shown(items, 'to_validate').length, processing: shown(items, 'processing').length, changed: shown(items, 'changed').length });

function SubViews({ view, counts, onView }: { view: ListFilter; counts: Record<ListFilter, number>; onView: (v: ListFilter) => void }) {
  return (
    <div role="group" aria-label="Filter the applications" className="mt-3 flex flex-wrap gap-2" data-testid="eligibility-views">
      {FILTERS.filter((f) => f.key !== 'processing' || counts.processing > 0).map((f) => (
        <button key={f.key} type="button" aria-pressed={view === f.key} data-testid={`view-${f.key}`} onClick={() => onView(f.key)}
          className={`min-h-[44px] rounded-full border px-3 py-1.5 text-sm sm:min-h-0 sm:py-1 ${view === f.key ? 'border-[#0E7490] bg-[#E8F4F8] font-semibold text-[#0A5F75]' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{f.label} ({counts[f.key]})</button>
      ))}
    </div>
  );
}

function Chips({ item }: { item: Item }) {
  const e = item.eligibility;
  return (
    <span className="mt-1 inline-flex flex-wrap items-center gap-1.5 align-middle">
      {e && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[e.state]}`} data-testid="eligibility-chip" title={e.reason}>{ELIGIBILITY_LABEL[e.state]}</span>}
      {(item.duplicates ?? 0) > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900" data-testid="duplicate-chip">Possible duplicate</span>}
    </span>
  );
}

export function SubmissionsTab({ callId, timezone, currency }: { callId: string; timezone: string; currency: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<(Detail & { id: string }) | null>(null);
  // The filter is in the address (?elig=not_fit), so a view can be shared and survives a reload.
  const [view, setViewState] = useState<ListFilter>(() => { try { const v = new URLSearchParams(window.location.search).get('elig'); return isFilter(v) ? v : 'all'; } catch { return 'all'; } });
  const setView = useCallback((v: ListFilter) => {
    setViewState(v);
    try { const u = new URL(window.location.href); if (v === 'all') u.searchParams.delete('elig'); else u.searchParams.set('elig', FILTERS.find((f) => f.key === v)!.param); window.history.replaceState(window.history.state, '', u.toString()); } catch { /* an address that cannot be rewritten: the filter still works */ }
  }, []);

  const load = useCallback(async (alive: () => boolean = () => true) => {
    try {
      const r = await fetch(`/api/calls/${callId}/submissions`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      if (!alive()) return null;
      if (r.ok && d?.ok) { setItems(d.submissions); return d as { counts?: Record<EligibilityView, number> }; }
      setItems([]); setError(d?.error ?? 'You cannot view the submissions of this call.');
    } catch { if (alive()) { setItems([]); setError('We could not load the submissions.'); } }
    return null;
  }, [callId]);

  useEffect(() => {
    let alive = true;
    void load(() => alive).then(async (d) => {
      // Whatever is still waiting for its automatic check is taken forward now (the daily run is only the safety net), and the list is read again once.
      if (alive && d?.counts && d.counts.processing > 0) { await fetch(`/api/calls/${callId}/submissions/process`, { method: 'POST' }).catch(() => undefined); if (alive) await load(() => alive); }
    });
    return () => { alive = false; };
  }, [callId, load]);

  async function show(id: string) {
    setError('');
    const r = await fetch(`/api/calls/${callId}/submissions/${id}`, { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { setError('We could not open that application.'); return; }
    setOpen({ ...(d as Detail), id });
  }

  if (open) {
    const pages = visiblePages(open.fields, open.answers);
    return (
      <DocViewerProvider docs={open.documents}>
      <section data-testid="submission-detail">
        <button type="button" onClick={() => setOpen(null)} className="min-h-[44px] text-sm text-gray-500 hover:text-[#0E7490] sm:min-h-0">← Applications</button>
        <h2 className="mt-2 text-base font-semibold text-gray-900">{open.startup} <span className="font-mono text-xs font-normal text-gray-500">{open.reference}</span></h2>
        <p className="text-xs text-gray-500">Submitted {formatInZone(open.submittedAt, timezone)} · version {open.version} · read-only: exactly as it was submitted</p>
        {(open.duplicates ?? []).length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="possible-duplicate">
            <p className="font-semibold">Possible duplicate</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs [overflow-wrap:anywhere]">{(open.duplicates ?? []).map((d) => <li key={d.applicationId}>{duplicateSentence(d)}</li>)}</ul>
            <p className="mt-1 text-[11px] text-amber-900">Nothing is blocked: you decide, in the light of what counts as one entity in this call.</p>
          </div>
        )}
        {open.eligibility && <div className="mt-3"><ApplicationEligibility callId={callId} applicationId={open.id} info={open.eligibility} canCorrect={open.canCorrect === true} canFlag={open.canFlag === true} documents={open.documents} fields={open.fields} answers={open.answers} currency={currency} onChanged={() => { void show(open.id); void load(); }} /></div>}
        <div className="mt-4 space-y-6">
          {pages.map((p, i) => (
            <div key={p.page}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Page {i + 1}</h3>
              <dl className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {p.fields.map((f) => (
                  <div key={f.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[14rem_1fr]">
                    <dt className="text-sm text-gray-500">{f.label}</dt>
                    <dd className="whitespace-pre-line text-sm text-gray-900" data-testid="answer">
                      <AnswerView field={f} value={open.answers[f.id]} docs={open.documents} currency={currency} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
      </DocViewerProvider>
    );
  }

  return (
    <section data-testid="submissions-tab">
      <h2 className="text-base font-semibold text-gray-900">Applications</h2>
      <p className="mt-1 text-xs text-gray-500">Applications that were submitted, read-only. Applications still being filled in are never shown to the organisation that runs the call.</p>
      {error && <p role="alert" className="mt-3 text-sm text-[#B00000]">{error}</p>}
      {items !== null && items.length > 0 && <SubViews view={view} counts={filterCounts(items)} onView={setView} />}
      {items === null ? <p className="mt-4 text-sm text-gray-400">Loading…</p> : items.length === 0 && !error ? (
        <p className="mt-4 text-sm text-gray-500" data-testid="no-submissions">No applications have been submitted yet.</p>
      ) : items.length > 0 ? (
        <>
          {shown(items, view).length === 0 && <p className="mt-4 text-sm text-gray-500" data-testid="no-in-view">No application in this list.</p>}
          {/* A phone cannot hold a table: each application is a card. From a tablet up it is the table. */}
          <ul className="mt-4 space-y-2 sm:hidden" data-testid="submission-cards">
            {shown(items, view).map((s) => (
              <li key={s.applicationId} className="rounded-lg border border-gray-200 bg-white p-4" data-testid="submission-card">
                <p className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{s.startup}</p>
                <Chips item={s} />
                <p className="mt-0.5 font-mono text-xs text-gray-500">{s.reference ?? '—'}</p>
                <p className="mt-1 text-xs text-gray-500">Submitted {formatInZone(s.submittedAt, timezone)}</p>
                <button type="button" onClick={() => void show(s.applicationId)} className="mt-2 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-sm font-semibold text-[#0E7490]">Open</button>
              </li>
            ))}
          </ul>
          <div className="hidden sm:block">
          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-4 py-2 font-medium">Startup</th><th className="px-4 py-2 font-medium">Reference</th><th className="px-4 py-2 font-medium">Eligibility</th><th className="px-4 py-2 font-medium">Submitted</th><th /></tr></thead>
              <tbody>
                {shown(items, view).map((s) => (
                  <tr key={s.applicationId} className="border-t border-gray-100" data-testid="submission-row">
                    <td className="px-4 py-2 font-medium text-gray-900">{s.startup}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-600">{s.reference ?? '—'}</td>
                    <td className="px-4 py-2"><Chips item={s} /></td>
                    <td className="px-4 py-2 text-gray-600">{formatInZone(s.submittedAt, timezone)}</td>
                    <td className="px-4 py-2 text-right"><button type="button" onClick={() => void show(s.applicationId)} className="text-xs font-semibold text-[#0E7490] hover:underline">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
