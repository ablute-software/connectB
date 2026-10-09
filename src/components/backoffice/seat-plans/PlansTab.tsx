'use client';
// Prompt 904 Adenda 1 (v2) — sub-tab 2, "Firms with a custom plan": the list (search by firm name, sort by plan
// creation / last change / name) and, under the row you click, the same management as sub-tab 1 plus editing
// and ending the plan. The open firm lives in the URL (?firm=), so a refresh keeps it open.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { PLAN_SORT_LABELS, searchPlans, sortPlans, type PlanRow, type PlanSort } from '@/lib/seat-plans-view';
import { FirmManager } from './FirmManager';
import { day, getJson } from './shared';

export function PlansTab({ openFirm, onOpen, onEnded, refreshKey }: {
  openFirm: string | null; onOpen: (id: string | null) => void; onEnded: () => void; refreshKey: number;
}) {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<PlanSort>('created');

  const load = useCallback(() => {
    void getJson<{ firms: PlanRow[] }>('').then((d) => {
      if (d.migrationPending) { setPending(true); setRows([]); return; }
      setRows(d.ok ? d.firms : []);
    });
  }, []);
  useEffect(load, [load, refreshKey]);

  const shown = rows ? sortPlans(searchPlans(rows, q), sort) : [];

  return (
    <div className="space-y-3">
      {pending && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          The database migration for custom seat plans has not been applied yet, so nothing here can be saved.
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Search by firm name
          <input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Firm name…" aria-label="Search firms"
            className="mt-0.5 block w-64 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="text-xs text-gray-500">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as PlanSort)} aria-label="Sort firms"
            className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
            {(Object.keys(PLAN_SORT_LABELS) as PlanSort[]).map((k) => <option key={k} value={k}>{PLAN_SORT_LABELS[k]}</option>)}
          </select></label>
        <span className="pb-1 text-xs text-gray-400">{rows ? `${shown.length} of ${rows.length}` : ''}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2">
        {rows === null ? <p className="p-2 text-xs text-gray-400">Loading…</p> : shown.length === 0 ? (
          <p className="p-2 text-xs text-gray-400">{rows.length === 0 ? 'No firm has a custom plan yet.' : 'No firm matches that search.'}</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500">
              <tr><th className="p-1.5">Firm</th><th>Plan</th><th>Seats</th><th>In use</th><th>Reserved</th><th>Free</th><th>Administrator</th><th>Created</th><th>Last change</th></tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const open = openFirm === f.entityId;
                return (
                  <Fragment key={f.entityId}>
                    <tr className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${open ? 'bg-[#E8F4F8]' : ''}`} data-testid={`plan-row-${f.entityId}`}
                      onClick={() => onOpen(open ? null : f.entityId)} aria-expanded={open}>
                      <td className="p-1.5 font-medium text-gray-900">{open ? '▾ ' : '▸ '}{f.name}</td><td>{f.planName}</td><td>{f.seats}</td>
                      <td>{f.used}</td><td>{f.reserved}</td><td>{f.free}</td><td>{f.adminEmail ?? '—'}</td><td>{day(f.createdAt)}</td><td>{day(f.updatedAt)}</td>
                    </tr>
                    {open && (
                      <tr><td colSpan={9} className="bg-gray-50 p-3">
                        <FirmManager key={f.entityId} entityId={f.entityId} mode="expanded" onChanged={load} onEnded={onEnded} />
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
