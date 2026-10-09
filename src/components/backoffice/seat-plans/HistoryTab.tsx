'use client';
// Prompt 904 Adenda 1 (v2) — sub-tab 3, "History": every firm's seat events in one list, newest first.
// Filters: firm, event type, date range; search by firm name or email. The filtering is done by the route
// (and by the same pure function the tests use), so what is shown is what the filters say.
import { useEffect, useState } from 'react';
import { EVENT_LABELS, EVENT_TYPES, describeEvent, eventLabel, type HistoryRow } from '@/lib/seat-plans-view';
import { getJson, stamp } from './shared';

type FirmOption = { entityId: string; name: string };

export function HistoryTab({ refreshKey }: { refreshKey: number }) {
  const [firms, setFirms] = useState<FirmOption[]>([]);
  const [firm, setFirm] = useState('');
  const [event, setEvent] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');

  // The firm picker: firms that have (or had) a plan.
  useEffect(() => {
    void Promise.all([
      getJson<{ firms: FirmOption[] }>(''),
      getJson<{ rows: FirmOption[] }>('?view=ended'),
    ]).then(([a, b]) => {
      const seen = new Map<string, string>();
      for (const f of [...(a.ok ? a.firms : []), ...(b.ok ? b.rows : [])]) seen.set(f.entityId, f.name);
      setFirms([...seen].map(([entityId, name]) => ({ entityId, name })).sort((x, y) => x.name.localeCompare(y.name)));
    }).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    const qs = new URLSearchParams({ view: 'history' });
    if (firm) qs.set('entityId', firm);
    if (event) qs.set('event', event);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (q.trim()) qs.set('q', q.trim());
    const t = setTimeout(() => {
      void getJson<{ rows: HistoryRow[]; truncated: boolean }>(`?${qs.toString()}`).then((d) => {
        if (!d.ok) { setError(d.error ?? 'Could not load.'); setRows([]); return; }
        setError(''); setRows(d.rows); setTruncated(d.truncated);
      });
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [firm, event, from, to, q, refreshKey]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">Firm
          <select value={firm} onChange={(e) => setFirm(e.target.value)} aria-label="Filter by firm" className="mt-0.5 block w-56 rounded-lg border border-gray-300 px-2 py-1 text-sm">
            <option value="">All firms</option>
            {firms.map((f) => <option key={f.entityId} value={f.entityId}>{f.name}</option>)}
          </select></label>
        <label className="text-xs text-gray-500">Event
          <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Filter by event" className="mt-0.5 block w-48 rounded-lg border border-gray-300 px-2 py-1 text-sm">
            <option value="">All events</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]}</option>)}
          </select></label>
        <label className="text-xs text-gray-500">From
          <input type="date" autoComplete="off" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="text-xs text-gray-500">To
          <input type="date" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="text-xs text-gray-500">Search firm or email
          <input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Firm or email…" aria-label="Search history" className="mt-0.5 block w-56 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
        {(firm || event || from || to || q) && (
          <button type="button" onClick={() => { setFirm(''); setEvent(''); setFrom(''); setTo(''); setQ(''); }} className="pb-1 text-xs text-[#0E7490] hover:underline">Clear filters</button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-[#B00000]">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-2">
        {rows === null ? <p className="p-2 text-xs text-gray-400">Loading…</p> : rows.length === 0 ? <p className="p-2 text-xs text-gray-400">Nothing matches.</p> : (
          <table className="w-full text-left text-xs" data-testid="history-table">
            <thead className="text-gray-500"><tr><th className="p-1.5">When</th><th>Firm</th><th>Event</th><th>Who did it</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  <td className="whitespace-nowrap p-1.5 text-gray-500">{stamp(r.createdAt)}</td>
                  <td className="font-medium text-gray-900">{r.firm}</td>
                  <td>{eventLabel(r.event)}</td>
                  <td>{r.actorEmail ?? <span className="text-gray-400">system / the person</span>}</td>
                  <td className="text-gray-600">{[r.personEmail, describeEvent(r)].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {truncated && <p className="p-2 text-[11px] text-gray-400">Showing the most recent rows only. Narrow the filters to see older ones.</p>}
      </div>
    </div>
  );
}
