'use client';
// Prompt 373 §C — "the bridge that justifies the app": investors who
// financed this org's competitors, cross-referenced against the founder's
// own pipeline. One click adds a missing one as a new target with a
// pre-written, verifiable hook — never sends anything itself (see
// add-target/route.ts's own header for why that's safe re: outreach
// discipline).
import { useEffect, useState } from 'react';

interface BridgeInvestor {
  investorEntityId: string; investorName: string;
  backedCompanies: { companyName: string; amountEur: number | null; investedAt: string | null; roundType: string | null }[];
  hookLine: string;
}
interface BridgeData { inPipeline: BridgeInvestor[]; missing: BridgeInvestor[] }

export function InvestorBridgeCard() {
  const [data, setData] = useState<BridgeData | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  function load() {
    fetch('/api/market-data/bridge').then((r) => r.json()).then((body) => setData({ inPipeline: body.inPipeline ?? [], missing: body.missing ?? [] })).catch(() => setData({ inPipeline: [], missing: [] }));
  }
  useEffect(load, []);

  async function addTarget(investorEntityId: string) {
    setAddingId(investorEntityId); setError('');
    try {
      const res = await fetch('/api/market-data/bridge/add-target', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ investorEntityId }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not add this investor.'); return; }
      setAddedIds((prev) => new Set(prev).add(investorEntityId));
    } finally { setAddingId(null); }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const total = data.inPipeline.length + data.missing.length;
  if (total === 0) {
    return <p className="text-sm text-gray-400">No known investors of your declared competitors yet — add competitors above with their funding rounds.</p>;
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-800">
        {total} investor{total === 1 ? '' : 's'} financed companies in your space — {data.inPipeline.length} already in your pipeline, {data.missing.length} not.
      </p>
      {error && <p className="mt-1 text-xs text-[#B00000]">{error}</p>}
      {data.missing.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {data.missing.map((inv) => (
            <div key={inv.investorEntityId} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2 text-xs">
              <div>
                <p className="font-medium text-gray-800">{inv.investorName}</p>
                <p className="text-gray-500">They {inv.hookLine}.</p>
              </div>
              {addedIds.has(inv.investorEntityId) ? (
                <span className="shrink-0 text-[#0E7490]">Added ✓</span>
              ) : (
                <button disabled={addingId === inv.investorEntityId} onClick={() => addTarget(inv.investorEntityId)}
                  className="shrink-0 rounded-lg bg-[#0E7490] px-2.5 py-1 font-medium text-white disabled:opacity-40">
                  {addingId === inv.investorEntityId ? 'Adding…' : 'Add as target'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
