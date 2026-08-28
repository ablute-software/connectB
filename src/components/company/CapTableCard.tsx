'use client';
// Prompt 422 §B — structured cap table data entry, same shape as
// PreviousFundingCard.tsx (list + add form + running total), living
// alongside the round data it complements. Data entry only, no chart on
// this side — that's the investor-side Ownership calculator (§C).
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { capTableTotal, isCapTableTotalOff } from '@/lib/cap-table';
import { CapTableAiFillPanel } from './CapTableAiFillPanel';
import type { CapTableEntry } from '@/lib/types';

const CATEGORY_LABEL: Record<CapTableEntry['category'], string> = {
  founder: 'Founder', option_pool: 'Option pool', adviser: 'Adviser', investor: 'Investor',
};
const CATEGORIES: CapTableEntry['category'][] = ['founder', 'option_pool', 'adviser', 'investor'];

function fmtPct(n: number) {
  return `${n % 1 === 0 ? n : n.toFixed(1)}%`;
}

export function CapTableCard() {
  const { db, addCapTableEntry, removeCapTableEntry } = useStore();
  const [category, setCategory] = useState<CapTableEntry['category']>('founder');
  const [label, setLabel] = useState('');
  const [pct, setPct] = useState('');
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  const entries = db.capTableEntries ?? [];
  const total = capTableTotal(entries);
  const totalOff = isCapTableTotalOff(entries);

  async function add() {
    const pctNum = Number(pct);
    if (!label.trim() || !pct || Number.isNaN(pctNum) || pctNum < 0 || pctNum > 100) return;
    await addCapTableEntry({ category, label: label.trim(), pct: pctNum, as_of: asOf });
    setLabel(''); setPct('');
  }

  return (
    <Card title="Cap table">
      <p className="mb-2 text-xs text-gray-500">
        Your ownership structure — founders, option pool, advisers, named investors. Shown to investors as a chart
        in their Ownership calculator once you&apos;ve added rows here.
      </p>

      {entries.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-sm">
              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{CATEGORY_LABEL[e.category]}</span>
              <span className="font-medium text-gray-900">{e.label}</span>
              <span className="tabular-nums text-gray-700">{fmtPct(e.pct)}</span>
              <span className="text-xs text-gray-400">as of {e.as_of}</span>
              <button onClick={() => removeCapTableEntry(e.id)} className="ml-auto text-[11px] text-gray-400 hover:text-[#B00000]">remove</button>
            </li>
          ))}
          <li className={`border-t border-gray-100 pt-1 text-sm font-semibold ${totalOff ? 'text-amber-700' : 'text-gray-900'}`}>
            Total: {fmtPct(total)}
            {totalOff && <span className="ml-2 text-xs font-normal text-amber-600">doesn&apos;t add up to ~100% yet</span>}
          </li>
        </ul>
      ) : (
        <p className="mb-3 text-xs text-gray-400">Nothing recorded yet.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value as CapTableEntry['category'])}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm">
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Founder A, ESOP pool, Seed investors…"
          className="w-48 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <input value={pct} onChange={(e) => setPct(e.target.value)} type="number" min="0" max="100" step="0.1" placeholder="%"
          className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <input value={asOf} onChange={(e) => setAsOf(e.target.value)} type="date"
          className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <button onClick={add} disabled={!label.trim() || !pct}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:bg-gray-300">
          Add
        </button>
      </div>

      <CapTableAiFillPanel orgId={db.org.id} addCapTableEntry={addCapTableEntry} />
    </Card>
  );
}
