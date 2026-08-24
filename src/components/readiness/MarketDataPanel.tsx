'use client';
// Prompt 360 Part A — "Market data — your sector": three sources on one
// founder-curated canvas. Founder-side only (§A4) — nothing here is
// investor-facing; TAM/SAM/SOM-style market-sizing numbers and competitor
// comparisons stay exactly where the founder put them, never flowing into
// the investor dossier, an export, or any AI prompt whose output an
// investor could see. company-knowledge.ts's own closed source list is
// unchanged by this feature — a founder who accepts a research item gets a
// real company_claims row (feeding Blueprint/mini-pitch through the
// EXISTING, already-audited claims pipeline), not a new investor-facing
// path.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { PlanBadge } from '@/components/PlanBadge';

interface Gate { eligible: boolean; missing: { key: string; label: string; href: string }[] }
interface DocItem { documentId: string; documentName: string; label: string }
interface AddedByYou {
  market_size_value_eur: number | null; market_size_scope: string | null; market_size_year: number | null;
  market_size_source: string | null; growth_pct: number | null;
  segments: string[]; competitors: { name: string; country?: string; stage?: string; funding?: string; note?: string }[];
  free_sources: { label: string; url: string }[];
}
interface ResearchItem {
  id: string; section: string; title: string; detail: string; source_url: string | null; confidence: string | null;
}

const SECTION_LABEL: Record<string, string> = {
  definition: 'Definition & scope', sizing: 'Market size', growth: 'Growth', players: 'Competitors',
  rounds: 'Comparable rounds', trends: 'Trends & drivers', regulatory: 'Regulatory',
};

const BLANK_ADDED: AddedByYou = {
  market_size_value_eur: null, market_size_scope: null, market_size_year: null, market_size_source: null,
  growth_pct: null, segments: [], competitors: [], free_sources: [],
};

export function MarketDataPanel() {
  const [gate, setGate] = useState<Gate | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [added, setAdded] = useState<AddedByYou>(BLANK_ADDED);
  const [savingAdded, setSavingAdded] = useState(false);
  const [researchItems, setResearchItems] = useState<ResearchItem[] | null>(null);
  const [researching, setResearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch('/api/market-data').then((r) => r.json()).then((body) => {
      if (!body.available) { setNotAvailable(true); return; }
      setGate(body.gate ?? null);
      setDocs(body.fromYourDocuments ?? []);
      if (body.addedByYou) setAdded({ ...BLANK_ADDED, ...body.addedByYou });
      setResearchItems(body.researchItems ?? []);
    }).catch(() => {});
  }
  useEffect(load, []);

  async function saveAdded() {
    setSavingAdded(true);
    try {
      await fetch('/api/market-data', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(added),
      });
    } finally { setSavingAdded(false); }
  }

  async function research(force: boolean) {
    setResearching(true);
    try {
      const res = await fetch(`/api/market-data/research${force ? '?force=1' : ''}`);
      const body = await res.json();
      if (body.items) setResearchItems(body.items);
    } finally { setResearching(false); }
  }

  async function respond(id: string, action: 'accept' | 'reject') {
    setBusyId(id);
    try {
      await fetch('/api/market-data/research/respond', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      setResearchItems((prev) => (prev ?? []).filter((i) => i.id !== id));
    } finally { setBusyId(null); }
  }

  function addCompetitor() {
    setAdded((a) => ({ ...a, competitors: [...a.competitors, { name: '' }] }));
  }
  function updateCompetitor(i: number, patch: Partial<AddedByYou['competitors'][number]>) {
    setAdded((a) => ({ ...a, competitors: a.competitors.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  }
  function removeCompetitor(i: number) {
    setAdded((a) => ({ ...a, competitors: a.competitors.filter((_, idx) => idx !== i) }));
  }

  if (notAvailable) return <p className="text-sm text-gray-400">Not available in this workspace yet.</p>;
  if (!gate) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-xs text-gray-500">
        Founder-only. Nothing here — market size, competitor notes, comparable rounds — ever reaches an investor. Use what
        you learn to improve what&apos;s already investor-facing (your Market text, claims with a source), by hand.
      </p>

      <div className="relative">
        {!gate.eligible && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/70 px-4 text-center backdrop-blur-[3px]">
            <span className="rounded-full border border-cyan-200 bg-white/95 px-4 py-1.5 text-sm font-semibold text-[#0E7490] shadow-sm">
              A few basics first
            </span>
            <ul className="max-w-xs space-y-1 text-xs text-gray-600">
              {gate.missing.map((m) => (
                <li key={m.key}>
                  <Link href={m.href} className="text-[#0E7490] underline">{m.label} →</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={!gate.eligible ? 'pointer-events-none select-none space-y-4 blur-[2px]' : 'space-y-4'} aria-hidden={!gate.eligible}>
          <Card title="From your documents">
            <p className="mb-2 text-xs text-gray-500">Already extracted from your Vault — no new reading, no new cost.</p>
            {docs.length === 0 ? (
              <p className="text-xs text-gray-400">Nothing market-related found in your Vault yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {docs.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-gray-700">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{d.documentName}</span>
                    {d.label}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Added by you">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-gray-600">
                Market size (€)
                <input type="number" value={added.market_size_value_eur ?? ''}
                  onChange={(e) => setAdded({ ...added, market_size_value_eur: e.target.value ? Number(e.target.value) : null })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-gray-600">
                Scope (e.g. TAM Europe)
                <input value={added.market_size_scope ?? ''} onChange={(e) => setAdded({ ...added, market_size_scope: e.target.value })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-gray-600">
                Year
                <input type="number" value={added.market_size_year ?? ''}
                  onChange={(e) => setAdded({ ...added, market_size_year: e.target.value ? Number(e.target.value) : null })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-gray-600">
                Source
                <input value={added.market_size_source ?? ''} onChange={(e) => setAdded({ ...added, market_size_source: e.target.value })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-gray-600">
                Growth (%/yr)
                <input type="number" value={added.growth_pct ?? ''}
                  onChange={(e) => setAdded({ ...added, growth_pct: e.target.value ? Number(e.target.value) : null })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-gray-600">
                Segments (comma-separated)
                <input value={added.segments.join(', ')} onChange={(e) => setAdded({ ...added, segments: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
            </div>

            <p className="mb-1 mt-3 text-xs font-medium text-gray-600">Competitors</p>
            <div className="space-y-1.5">
              {added.competitors.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <input placeholder="Name" value={c.name} onChange={(e) => updateCompetitor(i, { name: e.target.value })}
                    className="w-32 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <input placeholder="Country" value={c.country ?? ''} onChange={(e) => updateCompetitor(i, { country: e.target.value })}
                    className="w-24 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <input placeholder="Stage" value={c.stage ?? ''} onChange={(e) => updateCompetitor(i, { stage: e.target.value })}
                    className="w-24 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <input placeholder="Funding" value={c.funding ?? ''} onChange={(e) => updateCompetitor(i, { funding: e.target.value })}
                    className="w-24 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <input placeholder="Note" value={c.note ?? ''} onChange={(e) => updateCompetitor(i, { note: e.target.value })}
                    className="w-32 flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                  <button onClick={() => removeCompetitor(i)} className="text-xs text-gray-400 hover:text-[#B00000]">remove</button>
                </div>
              ))}
              <button onClick={addCompetitor} className="text-xs text-[#0E7490] hover:underline">+ Add competitor</button>
            </div>

            <button disabled={savingAdded} onClick={saveAdded}
              className="mt-3 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {savingAdded ? 'Saving…' : 'Save'}
            </button>
          </Card>

          <Card title={<span className="inline-flex items-center gap-2">Sherlock research <PlanBadge tier="motherfunding" /></span>}>
            <p className="mb-2 text-xs text-gray-500">
              Structured web research on your sector — every item comes with a real source. Nothing is added automatically.
            </p>
            <button disabled={researching} onClick={() => research(researchItems !== null && researchItems.length > 0)}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {researching ? 'Researching…' : 'Research my sector'}
            </button>
            {researchItems !== null && researchItems.length > 0 && (
              <button disabled={researching} onClick={() => research(true)} className="ml-2 text-xs text-[#0E7490] hover:underline">
                Refresh
              </button>
            )}
            {researchItems !== null && researchItems.length === 0 && !researching && (
              <p className="mt-2 text-xs text-gray-400">No pending suggestions — click above to research your sector.</p>
            )}
            {researchItems && researchItems.length > 0 && (
              <div className="mt-3 space-y-2">
                {researchItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-gray-200 p-2.5">
                    <p className="text-[10px] font-medium uppercase text-gray-400">{SECTION_LABEL[item.section] ?? item.section}</p>
                    <p className="mt-0.5 text-sm text-gray-800">{item.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{item.detail}</p>
                    {item.source_url && (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-[11px] text-[#0E7490] underline">
                        {item.source_url}
                      </a>
                    )}
                    <div className="mt-1.5 flex gap-1.5">
                      <button disabled={busyId === item.id} onClick={() => respond(item.id, 'accept')}
                        className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                        Accept ✓
                      </button>
                      <button disabled={busyId === item.id} onClick={() => respond(item.id, 'reject')}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                        Ignore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
