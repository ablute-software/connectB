'use client';
// Prompt 904 Adenda 1 (v2) — sub-tab 4, "Ended plans": every plan that ended, with its data, when it began, when
// and by whom it ended, and — under the row you click — who held a seat at the moment it ended. A firm can
// appear more than once (it can have had several plans). Plans are never deleted: this is the record.
import { Fragment, useEffect, useState } from 'react';
import { ACTIVATED_VIA_LABELS, ENDED_SORT_LABELS, searchPlans, sortEnded, type EndedRow, type EndedSort } from '@/lib/seat-plans-view';
import { day, getJson, stamp } from './shared';

export function EndedTab({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<EndedRow[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<EndedSort>('ended');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void getJson<{ rows: EndedRow[] }>('?view=ended').then((d) => setRows(d.ok ? d.rows : []));
  }, [refreshKey]);

  const shown = rows ? sortEnded(searchPlans(rows, q), sort) : [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Ending a plan removes nobody: the firm goes back to its 1/2/5 tier. The plan is kept here, with who held a seat when it ended.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Search by firm name
          <input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Firm name…" aria-label="Search ended plans"
            className="mt-0.5 block w-64 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="text-xs text-gray-500">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as EndedSort)} aria-label="Sort ended plans" className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
            {(Object.keys(ENDED_SORT_LABELS) as EndedSort[]).map((k) => <option key={k} value={k}>{ENDED_SORT_LABELS[k]}</option>)}
          </select></label>
        <span className="pb-1 text-xs text-gray-400">{rows ? `${shown.length} of ${rows.length}` : ''}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2">
        {rows === null ? <p className="p-2 text-xs text-gray-400">Loading…</p> : shown.length === 0 ? (
          <p className="p-2 text-xs text-gray-400">{rows.length === 0 ? 'No plan has ended yet.' : 'No ended plan matches that search.'}</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500">
              <tr><th className="p-1.5">Firm</th><th>Plan</th><th>Seats</th><th>Administrator</th><th>How it started</th><th>Created</th><th>Ended</th><th>Ended by</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${isOpen ? 'bg-[#E8F4F8]' : ''}`} data-testid={`ended-row-${r.id}`}
                      onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                      <td className="p-1.5 font-medium text-gray-900">{isOpen ? '▾ ' : '▸ '}{r.name}</td>
                      <td>{r.planName}{r.reconstructed && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700">reconstructed from history</span>}</td>
                      <td>{r.seats}</td><td>{r.adminEmail ?? '—'}</td><td>{ACTIVATED_VIA_LABELS[r.activatedVia] ?? r.activatedVia}</td>
                      <td>{day(r.planCreatedAt)}</td><td>{stamp(r.endedAt)}</td><td>{r.endedByEmail ?? '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={8} className="bg-gray-50 p-3">
                        <h3 className="text-sm font-semibold text-gray-900">Who held each seat</h3>
                        <p className="mt-0.5 text-[11px] text-gray-500">At the moment the plan ended{r.reconstructed ? ' (rebuilt from the history: roles are the current ones)' : ''}.</p>
                        <table className="mt-2 w-full text-left text-xs">
                          <thead className="text-gray-500"><tr><th className="py-1">Person</th><th>Role</th><th>Since</th></tr></thead>
                          <tbody>
                            {r.members.length === 0 && <tr><td colSpan={3} className="py-2 text-gray-400">Nobody held a seat.</td></tr>}
                            {r.members.map((m, i) => (
                              <tr key={`${m.userId ?? m.email ?? i}`} className="border-t border-gray-100">
                                <td className="py-1.5"><span className="font-medium text-gray-900">{m.name ?? m.email ?? 'Unknown'}</span>{m.name && m.email && <span className="ml-2 text-gray-400">{m.email}</span>}</td>
                                <td>{m.role ?? '—'}</td><td>{day(m.since)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
