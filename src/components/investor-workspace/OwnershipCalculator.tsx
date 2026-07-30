'use client';
// Investor Workspace Tools (prompt 62.1) — dilution/ownership calculator.
// Collapsible, per Pipeline card. No schema, no server round-trip — pure
// client-side math over data the Pipeline card already has.
import { useState } from 'react';
import { computeDilution } from '@/lib/dilution';

function fmtEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) {
  return `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
}

export function OwnershipCalculator({ roundValuationEur, roundTargetEur }: { roundValuationEur: number | null; roundTargetEur: number | null }) {
  const [open, setOpen] = useState(false);
  const [ticket, setTicket] = useState('50000');
  const [basis, setBasis] = useState<'pre_money' | 'post_money'>('post_money');
  const [futureDilutions, setFutureDilutions] = useState(['20', '15']);

  if (!open) {
    return <button onClick={() => setOpen(true)} className="text-xs text-gray-400 hover:underline">Ownership calculator</button>;
  }
  if (roundValuationEur == null) {
    return <p className="mt-2 text-xs text-gray-400">No valuation on file for this round yet — the calculator needs one.</p>;
  }

  const ticketEur = Number(ticket) || 0;
  const result = computeDilution({
    ticketEur, roundValuationEur, roundTargetEur: roundTargetEur ?? 0, valuationBasis: basis,
    futureRoundDilutionsPct: futureDilutions.map((d) => Number(d) || 0),
  });

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          Your ticket
          <input type="number" value={ticket} onChange={(e) => setTicket(e.target.value)} className="w-24 rounded border border-gray-300 px-1.5 py-0.5" />
        </label>
        <label className="flex items-center gap-1.5">
          Valuation is
          <select value={basis} onChange={(e) => setBasis(e.target.value as 'pre_money' | 'post_money')} className="rounded border border-gray-300 px-1 py-0.5">
            <option value="post_money">post-money</option>
            <option value="pre_money">pre-money</option>
          </select>
        </label>
        <button onClick={() => setOpen(false)} className="ml-auto text-gray-400 hover:underline">Close</button>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-base font-semibold text-[#0E7490]">{fmtPct(result.ownershipAfterThisRoundPct)}</span>
        <span className="text-gray-500">ownership after this round · post-money {fmtEur(result.postMoneyEur)}</span>
      </div>

      <div className="mt-2">
        <div className="mb-1 text-gray-500">Hypothetical future rounds (dilution %):</div>
        <div className="flex flex-wrap items-center gap-2">
          {futureDilutions.map((d, i) => (
            <input key={i} type="number" value={d}
              onChange={(e) => setFutureDilutions(futureDilutions.map((v, j) => (j === i ? e.target.value : v)))}
              className="w-16 rounded border border-gray-300 px-1.5 py-0.5" />
          ))}
        </div>
        {result.ownershipAfterFutureRoundsPct.map((pct, i) => (
          <div key={i} className="mt-1 text-gray-600">After round +{i + 1}: <span className="font-medium">{fmtPct(pct)}</span></div>
        ))}
      </div>
    </div>
  );
}
