'use client';
// Prompt 570 §B — the Queue opens on what needs deciding, not on tab one.
//
// Twelve tabs, seven of them empty, and the page opened on whichever came
// first. Finding the queue with work in it meant clicking through all of them.
//
// Three things this board refuses to do:
//
// Count history. `contributions` holds 734 rows and four are still undecided;
// a card reading 734 would be true and useless.
//
// Hide in silence. The candidates queue has 59 open rows and every one belongs
// to an internal account, so with the default filter it reads zero — and says
// "59 hidden (internal)" beside it. A bare 0 would mean "nothing to do" when
// it means "nothing of it is yours".
//
// Call something clear when it does not know. Three queues are computed by
// their own tabs rather than stored, so they report null; they show a dash and
// stay out of "All clear", because not knowing is not zero.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

export interface QueueSummaryRow {
  key: string;
  count: number | null;
  hiddenInternal?: number;
  oldestDays?: number | null;
  slaDueInDays?: number | null;
}

const HIDE_INTERNAL_KEY = 'sd-queue-hide-internal';

export function QueueTriageBoard({
  labels, onOpen,
}: { labels: Record<string, string>; onOpen: (key: string) => void }) {
  const [rows, setRows] = useState<QueueSummaryRow[] | null>(null);
  const [err, setErr] = useState('');
  const [showClear, setShowClear] = useState(false);

  useEffect(() => {
    fetch('/api/backoffice/queue/summary').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRows(body.rows);
    }).catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <Card title="Queues"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!rows) return <Card title="Queues"><p className="text-sm text-gray-400">Loading…</p></Card>;

  const known = rows.filter((r) => labels[r.key]);
  // Clear means counted, zero, AND nothing withheld by the internal filter.
  //
  // A null count is unknown, and unknown belongs with the work, not with the
  // done. And a queue reading zero only because 59 rows are ours is not clear
  // either — folding it into a collapsed block would delete the one sentence
  // that explains the zero, which is the silent hiding this board exists to
  // avoid. It stays a card, showing 0 and saying why.
  const clear = known.filter((r) => r.count === 0 && !r.hiddenInternal);
  const busy = known.filter((r) => r.count !== 0 || !!r.hiddenInternal);

  // Deadlines first, then volume. An SLA is the only thing here that gets
  // worse by itself.
  const ordered = [...busy].sort((a, b) => {
    const sla = (r: QueueSummaryRow) => (r.slaDueInDays ?? Infinity);
    return sla(a) - sla(b) || (b.count ?? -1) - (a.count ?? -1);
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((r) => {
          const urgent = r.slaDueInDays !== null && r.slaDueInDays !== undefined && r.slaDueInDays < 7;
          return (
            <button key={r.key} onClick={() => onOpen(r.key)}
              className={`rounded-xl border p-3 text-left transition hover:border-[#0E7490] ${urgent ? 'border-[#B00000]/40 bg-[#B00000]/[0.03]' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-800">{labels[r.key]}</span>
                <span className={`text-lg font-semibold ${r.count === null ? 'text-gray-300' : 'text-gray-900'}`}>
                  {r.count ?? '—'}
                </span>
              </div>
              <div className="mt-1 space-y-0.5 text-[11px] text-gray-500">
                {r.count === null && <div className="text-gray-400">Counted when opened</div>}
                {!!r.hiddenInternal && (
                  <div className="text-gray-400">{r.hiddenInternal} hidden (internal)</div>
                )}
                {r.oldestDays !== null && r.oldestDays !== undefined && (r.count ?? 0) > 0 && (
                  <div>oldest: {r.oldestDays} day{r.oldestDays === 1 ? '' : 's'}</div>
                )}
                {r.slaDueInDays !== null && r.slaDueInDays !== undefined && (
                  <div className={urgent ? 'font-medium text-[#B00000]' : ''}>
                    {r.slaDueInDays >= 0
                      ? `1 due in ${r.slaDueInDays} day${r.slaDueInDays === 1 ? '' : 's'}`
                      : `overdue by ${Math.abs(r.slaDueInDays)} days`}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {clear.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/60">
          <button onClick={() => setShowClear(!showClear)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-500 hover:text-gray-700">
            <span>{showClear ? '▾' : '▸'}</span>
            All clear ({clear.length})
          </button>
          {showClear && (
            <div className="grid grid-cols-2 gap-1 px-3 pb-3 text-xs text-gray-400 sm:grid-cols-3">
              {clear.map((r) => (
                <button key={r.key} onClick={() => onOpen(r.key)} className="text-left hover:text-[#0E7490] hover:underline">
                  {labels[r.key]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared with the queue page so the board and the table agree on the default. */
export function readHideInternal(): boolean {
  try { return localStorage.getItem(HIDE_INTERNAL_KEY) !== '0'; } catch { return true; }
}
