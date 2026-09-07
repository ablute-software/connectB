'use client';
// Prompt 852 §F — the two new Insight tabs, one component: "Startup
// decisions" (the startup's own "not a fit for us") and "Passes / Over"
// (every investor-side pass, with what would restart it). Same table, same
// filters, different source — the only real difference is one column.
//
// Everything filters and paginates SERVER-side (/api/backoffice/decisions):
// the client never receives rows it then hides, which matters because these
// rows are founder-private and there is no reason for a browser to hold ones
// the developer didn't ask for.
import { useCallback, useEffect, useState } from 'react';

export type DecisionsKind = 'startup' | 'passes';

interface Row {
  id: string;
  startupName: string;
  investorName: string;
  date: string;
  reason: string | null;
  note: string;
  whatsNeeded?: string | null;
  founderName: string;
  founderEmail: string;
  revertedAt?: string | null;
}

const EMPTY_FILTERS = { startup: '', investor: '', founder: '', from: '', to: '' };

export function DecisionsTab({ kind }: { kind: DecisionsKind }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const query = useCallback((p: number) => {
    const params = new URLSearchParams({ kind, page: String(p) });
    for (const [k, v] of Object.entries(filters)) if (v.trim()) params.set(k, v.trim());
    return params;
  }, [kind, filters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr('');
    fetch(`/api/backoffice/decisions?${query(page)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return;
        if (!b.ok) { setErr(b.error ?? 'Could not load.'); return; }
        setRows(b.rows as Row[]); setTotal(b.total as number); setHasMore(b.hasMore as boolean);
      })
      .catch(() => { if (!cancelled) setErr('Could not load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, page]);

  function setFilter(key: keyof typeof EMPTY_FILTERS, value: string) {
    setPage(0);
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const showWhatsNeeded = kind === 'passes';

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        {kind === 'startup'
          ? 'Every time a startup recorded that an investor is not a fit for them. Never an investor rejection, and never counted as one.'
          : 'Every investor pass, with the founder’s own note on what would restart it.'}
        {' '}Back-office only — none of this is ever shown to an investor.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        {([['startup', 'Startup'], ['investor', 'Investor'], ['founder', 'Founder (name or email)']] as const).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            {label}
            <input value={filters[key]} onChange={(e) => setFilter(key, e.target.value)} autoComplete="off"
              className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
          </label>
        ))}
        {([['from', 'From'], ['to', 'To']] as const).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            {label}
            <input type="date" value={filters[key]} onChange={(e) => setFilter(key, e.target.value)} autoComplete="off"
              className="rounded border border-gray-300 px-2 py-1 text-xs" />
          </label>
        ))}
        <button onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">Clear</button>
        {/* Free to add: the route already has every row shaped and filtered
            at the point it would otherwise paginate. */}
        <a href={`/api/backoffice/decisions?${query(0)}&format=csv`}
          className="ml-auto text-xs text-gray-400 hover:underline">Export CSV</a>
      </div>

      {err && <p className="text-xs text-[#B00000]">{err}</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-2 py-1.5">Startup</th>
              <th className="px-2 py-1.5">Investor</th>
              <th className="px-2 py-1.5">Date</th>
              <th className="px-2 py-1.5">Reason / Note</th>
              {showWhatsNeeded && <th className="px-2 py-1.5">What&apos;s needed</th>}
              <th className="px-2 py-1.5">Founder/User</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              // A reverted decision is struck through with its revert date,
              // never hidden: a record that disappears when undone is a
              // worse audit trail than one that shows what happened.
              <tr key={r.id} className={`border-t border-gray-100 align-top ${r.revertedAt ? 'text-gray-400 line-through' : ''}`}>
                <td className="px-2 py-1.5">{r.startupName}</td>
                <td className="px-2 py-1.5">{r.investorName}</td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {r.date.slice(0, 10)}
                  {r.revertedAt && <span className="ml-1 no-underline">· reverted {r.revertedAt.slice(0, 10)}</span>}
                </td>
                <td className="px-2 py-1.5">
                  {r.reason && <span className="mr-1 rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-600">{r.reason.replace(/_/g, ' ')}</span>}
                  {r.note}
                </td>
                {showWhatsNeeded && <td className="px-2 py-1.5 text-gray-600">{r.whatsNeeded ?? '—'}</td>}
                <td className="px-2 py-1.5">
                  <div>{r.founderName}</div>
                  {r.founderEmail && <div className="text-[10px] text-gray-400">{r.founderEmail}</div>}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={showWhatsNeeded ? 6 : 5} className="px-2 py-6 text-center text-gray-400">
                {total === 0 ? 'Nothing recorded yet.' : 'No rows match these filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>{total} row{total === 1 ? '' : 's'}{loading ? ' · loading…' : ''}</span>
        <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="ml-auto rounded border border-gray-300 px-2 py-1 disabled:opacity-40">Previous</button>
        <button disabled={!hasMore} onClick={() => setPage((p) => p + 1)}
          className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
