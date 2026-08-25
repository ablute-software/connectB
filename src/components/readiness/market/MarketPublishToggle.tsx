'use client';
// Prompt 373 §F — group-by-group publication. Closed by default; publishing
// is always this explicit action, never the starting state. Sources always
// travel with whatever is published — this toggle only decides WHETHER a
// group leaves the server at all (dossier-fetch.ts's own market block),
// never how it's presented.
import { useEffect, useState } from 'react';
import { MARKET_GROUP_KEYS, type MarketGroupKey } from '@/lib/market-data-investor-projection';

const GROUP_LABEL: Record<MarketGroupKey, string> = {
  rings: 'Market rings', competitors: 'Competitors', rounds: 'Comparable rounds',
  trends: 'Trends', regulatory: 'Regulatory', definition: 'Definition',
};

export function MarketPublishToggle() {
  const [groups, setGroups] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/market-data/visibility').then((r) => r.json()).then((body) => setGroups(body.groups ?? [])).catch(() => setGroups([]));
  }, []);

  async function toggle(key: MarketGroupKey) {
    if (!groups) return;
    const next = groups.includes(key) ? groups.filter((g) => g !== key) : [...groups, key];
    setGroups(next); setBusy(true);
    try {
      await fetch('/api/market-data/visibility', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: next }) });
    } finally { setBusy(false); }
  }

  if (groups === null) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-700">Publish to investors — group by group, closed by default</p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        What you publish appears in your investor dossier exactly as you see it here, sources included. Nothing about
        your own outreach or pipeline is ever included, whatever you turn on.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {MARKET_GROUP_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={groups.includes(key)} disabled={busy} onChange={() => toggle(key)} />
            {GROUP_LABEL[key]}
          </label>
        ))}
      </div>
    </div>
  );
}
