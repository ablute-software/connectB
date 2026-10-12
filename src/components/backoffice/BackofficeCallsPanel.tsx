'use client';
// Prompt 908 — the back-office Calls list, read only. One row per call: organisation (and whether it is an
// investor firm or an incubator, "Test" on fixtures), the call, its status, who runs it, how many applications
// (numbers only), its link with Copy and Open, and its dates in the call's own time zone. A row expands to the
// phases, the fields per page, who confirmed it and when, and when it was published. Nothing is editable.
import { Fragment, useRef, useState } from 'react';
import {
  CALL_SORT_LABELS, KIND_LABELS, filterCallRows, personLabel, sortCallRows,
  type BackofficeCallRow, type CallSort,
} from '@/lib/calls/backoffice-view';
import { callLink } from '@/lib/calls/link';
import { formatDayInZone, formatInZone } from '@/lib/calls/tz';
import { CALL_STATUSES, CALL_STATUS_LABELS, type CallStatus } from '@/lib/calls/types';
import { StatusBadge } from '@/components/calls/StatusBadge';

/** Clipboard first; if the browser refuses, select the link and try the old command. Returns whether it copied. */
async function copy(text: string, el: HTMLElement | null): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* try the old way */ }
  try {
    if (el) {
      const range = document.createRange(); range.selectNodeContents(el);
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
      return document.execCommand('copy');
    }
  } catch { /* nothing else to try */ }
  return false;
}

function LinkCell({ url }: { url: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <span ref={ref} className="max-w-[16rem] select-all truncate font-mono text-[11px] text-gray-700" title={url} data-testid="call-link">{url}</span>
      <button type="button" onClick={async () => setState((await copy(url, ref.current)) ? 'copied' : 'failed')}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50">Copy</button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-[#0E7490] hover:bg-gray-50">Open</a>
      {state === 'copied' && <span role="status" className="text-[11px] text-emerald-700">Copied</span>}
      {state === 'failed' && <span role="status" className="text-[11px] text-amber-700">Selected: press Ctrl+C</span>}
    </div>
  );
}

const dayIn = (iso: string | null, tz: string) => (iso ? formatDayInZone(iso, tz) : '—');

export function BackofficeCallsTable({ rows, origin, initialOpen = null }: { rows: BackofficeCallRow[]; origin: string; initialOpen?: string | null }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CallStatus | ''>('');
  const [sort, setSort] = useState<CallSort>('created');
  const [open, setOpen] = useState<string | null>(initialOpen);

  const shown = sortCallRows(filterCallRows(rows, { q, status }), sort);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Search organisation or call
          <input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Organisation or call name…" aria-label="Search calls"
            className="mt-0.5 block w-72 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="text-xs text-gray-500">Status
          <select value={status} onChange={(e) => setStatus(e.target.value as CallStatus | '')} aria-label="Filter by status"
            className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
            <option value="">All statuses</option>
            {CALL_STATUSES.map((s) => <option key={s} value={s}>{CALL_STATUS_LABELS[s]}</option>)}
          </select></label>
        <label className="text-xs text-gray-500">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as CallSort)} aria-label="Sort calls"
            className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
            {(Object.keys(CALL_SORT_LABELS) as CallSort[]).map((k) => <option key={k} value={k}>{CALL_SORT_LABELS[k]}</option>)}
          </select></label>
        <span className="pb-1 text-xs text-gray-400">{shown.length} of {rows.length}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2">
        {shown.length === 0 ? (
          <p className="p-2 text-xs text-gray-400">{rows.length === 0 ? 'No call has been created yet.' : 'No call matches that.'}</p>
        ) : (
          <table className="w-full text-left text-xs" data-testid="calls-table">
            <thead className="text-gray-500">
              <tr><th className="p-1.5">Organisation</th><th>Call</th><th>Status</th><th>Admin</th><th>Applications</th><th>Link</th><th>Dates</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isOpen = open === r.id;
                const url = r.linkToken ? callLink(origin, r.linkToken) : null;
                return (
                  <Fragment key={r.id}>
                    <tr className={`cursor-pointer border-t border-gray-100 align-top hover:bg-gray-50 ${isOpen ? 'bg-[#E8F4F8]' : ''}`}
                      data-testid={`call-row-${r.id}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td className="p-1.5">
                        <div className="font-medium text-gray-900">{isOpen ? '▾ ' : '▸ '}{r.organisation.name}
                          {r.organisation.isTest && <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] font-normal text-gray-500">Test</span>}</div>
                        <div className="text-[10px] text-gray-400">{KIND_LABELS[r.organisation.kind]}</div>
                      </td>
                      <td className="font-medium text-gray-800">{r.name}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>{personLabel(r.admin)}</td>
                      <td className="whitespace-nowrap">
                        <span data-testid="apps-submitted"><b>{r.applications.submitted}</b> submitted</span>
                        <span className="block text-gray-500" data-testid="apps-in-progress">{r.applications.inProgress} in progress</span>
                      </td>
                      <td>{url ? <LinkCell url={url} /> : <span className="text-gray-400">Not published yet</span>}</td>
                      <td className="whitespace-nowrap text-gray-600">
                        <div>Created {dayIn(r.createdAt, r.timezone)}</div>
                        <div>Opens {dayIn(r.opensAt, r.timezone)}</div>
                        <div>Closes {dayIn(r.closesAt, r.timezone)}</div>
                        <div className="text-[10px] text-gray-400">{r.timezone}</div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={7} className="bg-gray-50 p-3" data-testid={`call-detail-${r.id}`}>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900">Phases</h3>
                            {r.phases.length === 0 ? <p className="mt-1 text-gray-400">None.</p> : (
                              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-gray-700">
                                {r.phases.map((p, i) => <li key={i}>{p.name}{p.startsOn || p.endsOn ? <span className="text-gray-500"> · {p.startsOn ?? '…'} → {p.endsOn ?? '…'}</span> : null}</li>)}
                              </ol>
                            )}
                            <h3 className="mt-3 text-sm font-semibold text-gray-900">Form</h3>
                            {r.fieldsPerPage.length === 0 ? <p className="mt-1 text-gray-400">No fields yet.</p> : (
                              <ul className="mt-1 space-y-0.5 text-gray-700">
                                {r.fieldsPerPage.map((p) => <li key={p.page}>Page {p.page}: {p.fields} field{p.fields === 1 ? '' : 's'}</li>)}
                              </ul>
                            )}
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900">Confirmed</h3>
                            <p className="mt-1 text-gray-700" data-testid="confirmed">
                              {r.validatedAt ? <>{personLabel(r.validatedBy)} · {formatInZone(r.validatedAt, r.timezone)}</> : <span className="text-gray-400">Not confirmed yet.</span>}
                            </p>
                            <h3 className="mt-3 text-sm font-semibold text-gray-900">Published</h3>
                            <p className="mt-1 text-gray-700" data-testid="published">
                              {r.publishedAt ? formatInZone(r.publishedAt, r.timezone) : <span className="text-gray-400">Not published yet.</span>}
                            </p>
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
