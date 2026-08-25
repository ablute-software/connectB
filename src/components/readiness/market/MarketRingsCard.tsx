'use client';
// Prompt 373 §A — the market in layers. AI proposes from already-extracted
// knowledge (never a fresh web call, never a number without a source — see
// market-rings.ts's own header); the founder always has the final Accept/
// Edit/Reject, ring by ring.
import { useEffect, useState } from 'react';
import { RING_ORDER, RING_LABEL, type RingKey } from '@/lib/market-rings';
import { isStale } from '@/lib/market-data-gaps';

interface Ring {
  ring: RingKey; label: string; definition: string | null; buyer: string | null; geography: string | null;
  size_value_eur: number | null; size_year: number | null; size_method: string | null; size_source_url: string | null;
  growth_pct: number | null; growth_period: string | null; expansion_condition: string | null;
  origin: 'ai_proposed' | 'founder'; status: 'proposed' | 'accepted'; updated_at: string;
}

const SIZE_METHOD_LABEL: Record<string, string> = { bottom_up: 'Bottom-up', top_down: 'Top-down', report: 'Report' };

function RingRow({ ring, onChanged }: { ring: Ring | null; ringKey: RingKey; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Ring>>(ring ?? {});
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(ring ?? {}); }, [ring]);

  async function send(action: 'accept' | 'edit' | 'reject', patch: Partial<Ring> = draft) {
    setBusy(true);
    try {
      await fetch('/api/market-data/rings', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action, ring: ringKeyOf(ring, patch), label: patch.label, definition: patch.definition, buyer: patch.buyer,
          geography: patch.geography, sizeValueEur: patch.size_value_eur, sizeYear: patch.size_year,
          sizeMethod: patch.size_method, sizeSourceUrl: patch.size_source_url, growthPct: patch.growth_pct,
          growthPeriod: patch.growth_period, expansionCondition: patch.expansion_condition,
        }),
      });
      setEditing(false);
      onChanged();
    } finally { setBusy(false); }
  }
  function ringKeyOf(r: Ring | null, patch: Partial<Ring>) { return (r?.ring ?? patch.ring) as RingKey; }

  if (!ring) return null;
  const stale = isStale(ring.updated_at, new Date());

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{RING_LABEL[ring.ring]}</span>
        <div className="flex items-center gap-1.5">
          {stale && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">ageing</span>}
          {ring.status === 'proposed' && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-800">AI proposed</span>}
        </div>
      </div>

      {!editing ? (
        <>
          <p className="mt-1 text-sm font-medium text-gray-800">{ring.label}</p>
          {ring.definition && <p className="mt-0.5 text-xs text-gray-500">{ring.definition}</p>}
          <p className="mt-1 text-sm text-gray-700">
            {ring.size_value_eur != null
              ? `€${ring.size_value_eur.toLocaleString()}${ring.size_year ? ` (${ring.size_year})` : ''} — ${SIZE_METHOD_LABEL[ring.size_method ?? ''] ?? 'unspecified method'}`
              : <span className="text-gray-400">No sourced number yet — better empty than invented.</span>}
          </p>
          {ring.size_source_url && (
            <a href={ring.size_source_url} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-[#0E7490] underline">{ring.size_source_url}</a>
          )}
          {ring.expansion_condition && <p className="mt-1 text-[11px] text-gray-400">To expand: {ring.expansion_condition}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ring.status === 'proposed' && (
              <button disabled={busy} onClick={() => send('accept')} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Accept ✓</button>
            )}
            <button onClick={() => setEditing(true)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">Edit</button>
            <button disabled={busy} onClick={() => send('reject')} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">Reject</button>
          </div>
        </>
      ) : (
        <div className="mt-2 space-y-1.5">
          <input value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Label" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <textarea value={draft.definition ?? ''} onChange={(e) => setDraft({ ...draft, definition: e.target.value })} placeholder="Definition" rows={2} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <div className="grid grid-cols-2 gap-1.5">
            <input value={draft.buyer ?? ''} onChange={(e) => setDraft({ ...draft, buyer: e.target.value })} placeholder="Buyer" className="rounded border border-gray-300 px-2 py-1 text-xs" />
            <input value={draft.geography ?? ''} onChange={(e) => setDraft({ ...draft, geography: e.target.value })} placeholder="Geography" className="rounded border border-gray-300 px-2 py-1 text-xs" />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <input type="number" value={draft.size_value_eur ?? ''} onChange={(e) => setDraft({ ...draft, size_value_eur: e.target.value ? Number(e.target.value) : null })} placeholder="Size (€)" className="rounded border border-gray-300 px-2 py-1 text-xs" />
            <input type="number" value={draft.size_year ?? ''} onChange={(e) => setDraft({ ...draft, size_year: e.target.value ? Number(e.target.value) : null })} placeholder="Year" className="rounded border border-gray-300 px-2 py-1 text-xs" />
            <select value={draft.size_method ?? ''} onChange={(e) => setDraft({ ...draft, size_method: e.target.value || null })} className="rounded border border-gray-300 px-2 py-1 text-xs">
              <option value="">Method…</option>
              <option value="bottom_up">Bottom-up</option>
              <option value="top_down">Top-down</option>
              <option value="report">Report</option>
            </select>
          </div>
          <input value={draft.size_source_url ?? ''} onChange={(e) => setDraft({ ...draft, size_source_url: e.target.value })} placeholder="Source URL for the size" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <textarea value={draft.expansion_condition ?? ''} onChange={(e) => setDraft({ ...draft, expansion_condition: e.target.value })} placeholder="What has to become true to expand beyond this ring" rows={2} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => send(ring.status === 'proposed' ? 'accept' : 'edit')} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
            <button onClick={() => { setDraft(ring); setEditing(false); }} className="text-xs text-gray-400 hover:underline">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MarketRingsCard() {
  const [rings, setRings] = useState<Ring[] | null>(null);
  const [proposing, setProposing] = useState(false);

  function load() {
    fetch('/api/market-data/rings').then((r) => r.json()).then((body) => setRings(body.rings ?? [])).catch(() => setRings([]));
  }
  useEffect(load, []);

  async function propose() {
    setProposing(true);
    try {
      await fetch('/api/market-data/rings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'propose' }) });
      load();
    } finally { setProposing(false); }
  }

  if (rings === null) return <p className="text-sm text-gray-400">Loading…</p>;
  const byRing = new Map(rings.map((r) => [r.ring, r]));

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">
        Three layers, not one number: <b>beachhead</b> (where you sell first), <b>serviceable</b> (what your product can
        serve today), <b>category</b> (the whole market). Each says what has to become true to expand to the next.
      </p>
      {rings.length === 0 ? (
        <button disabled={proposing} onClick={propose} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {proposing ? 'Proposing…' : 'Propose my market rings'}
        </button>
      ) : (
        <div className="space-y-2">
          {RING_ORDER.map((k) => <RingRow key={k} ring={byRing.get(k) ?? null} ringKey={k} onChanged={load} />)}
          {rings.length < 3 && (
            <button disabled={proposing} onClick={propose} className="text-xs text-[#0E7490] hover:underline disabled:opacity-40">
              {proposing ? 'Proposing…' : 'Propose the missing ring(s)'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
