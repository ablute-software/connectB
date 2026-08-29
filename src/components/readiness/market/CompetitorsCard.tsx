'use client';
// Prompt 373 §B/§0.2 — competitors as real cards, not a free-text list.
// Every write goes through /api/market-data/competitors, which searches the
// SHARED market_companies library by domain then name before creating a new
// row (§0.2 safeguard #3) — this component never decides that itself.
import { useEffect, useState } from 'react';
import { isStale } from '@/lib/market-data-gaps';

// Prompt 378 §C — a pending 'players' proposal, from either provenance:
// document_id/page (the Vault extraction pass) or source_url (web research).
interface PlayerSuggestion {
  id: string; section: string; title: string; detail: string;
  source_url: string | null; document_id?: string | null; page?: number | null;
  structured?: Record<string, unknown> | null;
}

interface Company {
  id: string; name: string; domain: string | null; sectors: string[] | null; description: string | null;
  company_type: string | null; life_status: string | null; last_round_type: string | null;
  last_round_amount_eur: number | null; last_round_date: string | null; last_known_valuation_eur: number | null;
  latest_news: string | null; latest_news_date: string | null; latest_news_url: string | null;
  source_url: string | null; source_quality: string | null; updated_at: string;
}
interface CompetitorRow {
  id: string; relation: 'direct' | 'indirect' | 'adjacent'; note: string | null; positioning: string | null;
  addedBy: 'ai' | 'founder'; company: Company; rounds: { amount_eur: number | null; invested_at: string | null; round_type: string | null; catalog_entities?: { name: string } }[];
}

const TYPE_LABEL: Record<string, string> = {
  startup: 'Startup', incumbent: 'Incumbent', academic_spinoff: 'Academic spin-off', adjacent: 'Adjacent', distributor: 'Distributor',
};
// Prompt 378 §E.2 — colour, not an emoji prefix: the life signal has to be
// readable at a glance in a list of cards.
const LIFE_CHIP: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700' },
  acquired: { label: 'Acquired', cls: 'bg-amber-50 text-amber-700' },
  closed: { label: 'Closed', cls: 'bg-red-50 text-[#B00000]' },
};

function CompetitorCard({ c, onChanged }: { c: CompetitorRow; onChanged: () => void }) {
  const [positioning, setPositioning] = useState(c.positioning ?? '');
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await fetch('/api/market-data/competitors', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'edit', id: c.id, positioning }),
      });
      onChanged();
    } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try {
      await fetch('/api/market-data/competitors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: c.id }) });
      onChanged();
    } finally { setBusy(false); }
  }
  async function flag() {
    if (!flagReason.trim()) return;
    setBusy(true);
    try {
      await fetch('/api/market-data/competitors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'flag', id: c.id, justification: flagReason }) });
      setFlagging(false); setFlagReason('');
    } finally { setBusy(false); }
  }

  const stale = isStale(c.company.updated_at, new Date());

  // Prompt 378 §E.2 — a real card with hierarchy, not a flat stack of
  // equal-weight lines: identity on top, money as its own bordered row,
  // life signal as a COLOURED chip (green/amber/red, readable at a glance),
  // and the source demoted to a quiet footer.
  const lifeChip = c.company.life_status ? LIFE_CHIP[c.company.life_status] : null;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900">{c.company.name}</p>
            {c.company.company_type && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                {TYPE_LABEL[c.company.company_type] ?? c.company.company_type}
              </span>
            )}
            {lifeChip && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${lifeChip.cls}`}>{lifeChip.label}</span>
            )}
          </div>
          {c.company.domain && <p className="truncate text-[11px] text-gray-400">{c.company.domain}</p>}
        </div>
        {stale && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">ageing</span>}
      </div>
      {c.company.description && <p className="mt-1.5 text-xs text-gray-600">{c.company.description}</p>}

      {/* Money — its own row, because "who funded them and how much" is the
          single thing an investor comparison actually turns on. */}
      {(c.company.last_round_type || c.company.last_known_valuation_eur || c.rounds.length > 0) && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Money</p>
          <div className="mt-0.5 space-y-0.5 text-[11px] text-gray-700">
            {c.company.last_round_type && (
              <p>
                <span className="font-medium">{c.company.last_round_type}</span>
                {c.company.last_round_amount_eur ? ` · €${c.company.last_round_amount_eur.toLocaleString()}` : ''}
                {c.company.last_round_date ? ` · ${c.company.last_round_date.slice(0, 4)}` : ''}
              </p>
            )}
            {c.company.last_known_valuation_eur && <p>Valuation €{c.company.last_known_valuation_eur.toLocaleString()}</p>}
            {c.rounds.length > 0 && (
              <p className="text-gray-500">Investors: {c.rounds.map((r) => r.catalog_entities?.name).filter(Boolean).join(', ')}</p>
            )}
          </div>
        </div>
      )}

      {c.company.latest_news && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          Latest: {c.company.latest_news}{c.company.latest_news_date ? ` (${c.company.latest_news_date})` : ''}
          {c.company.latest_news_url && <a href={c.company.latest_news_url} target="_blank" rel="noreferrer" className="ml-1 text-[#0E7490] underline">source</a>}
        </p>
      )}

      <label className="mt-2 block text-[11px] font-medium text-gray-500">
        Positioning — the real axis of difference, one sentence
        <textarea value={positioning} onChange={(e) => setPositioning(e.target.value)} rows={2}
          className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs" placeholder="e.g. We do continuous monitoring; they do point-in-time testing." />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button disabled={busy} onClick={save} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
        <button disabled={busy} onClick={remove} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">Remove</button>
        <button onClick={() => setFlagging((v) => !v)} className="text-xs text-gray-400 hover:underline">Flag a wrong fact</button>
      </div>

      {/* §E.2 — the source, demoted to a quiet footer rather than competing
          with the content above it. */}
      {c.company.source_url && (
        <p className="mt-2 border-t border-gray-100 pt-1.5">
          <a href={c.company.source_url} target="_blank" rel="noreferrer" className="block truncate text-[10px] text-gray-400 hover:text-[#0E7490] hover:underline">
            Source: {c.company.source_url}
          </a>
        </p>
      )}
      {flagging && (
        <div className="mt-1.5 rounded border border-amber-200 bg-amber-50 p-2">
          <textarea value={flagReason} onChange={(e) => setFlagReason(e.target.value)} rows={2} placeholder="What's wrong, and how do you know?"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <button disabled={busy || !flagReason.trim()} onClick={flag} className="mt-1 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Send flag to backoffice</button>
        </div>
      )}
    </div>
  );
}

function AddCompetitorForm({ onAdded, prefill }: { onAdded: () => void; prefill?: { name: string; description?: string; sourceUrl?: string } }) {
  const [open, setOpen] = useState(!!prefill);
  const [name, setName] = useState(prefill?.name ?? '');
  const [domain, setDomain] = useState('');
  const [sourceUrl, setSourceUrl] = useState(prefill?.sourceUrl ?? '');
  const [description, setDescription] = useState(prefill?.description ?? '');
  const [companyType, setCompanyType] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (!name.trim() || !sourceUrl.trim()) { setError('A name and a source URL are required.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/market-data/competitors', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'add', name, domain: domain || undefined, sourceUrl, description: description || undefined, companyType: companyType || undefined }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not add this competitor.'); return; }
      setName(''); setDomain(''); setSourceUrl(''); setDescription(''); setCompanyType(''); setOpen(false);
      onAdded();
    } finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-[#0E7490] hover:underline">+ Add a competitor</button>;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs">
      <div className="grid grid-cols-2 gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded border border-gray-300 px-2 py-1" />
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain (optional)" className="rounded border border-gray-300 px-2 py-1" />
        <select value={companyType} onChange={(e) => setCompanyType(e.target.value)} className="rounded border border-gray-300 px-2 py-1">
          <option value="">Type…</option>
          {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Source URL (required)" className="rounded border border-gray-300 px-2 py-1" />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line description" rows={2} className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1" />
      {error && <p className="mt-1 text-[#B00000]">{error}</p>}
      <div className="mt-1.5 flex gap-2">
        <button disabled={busy} onClick={submit} className="rounded-lg bg-[#0E7490] px-2.5 py-1 font-medium text-white disabled:opacity-40">Add</button>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:underline">Cancel</button>
      </div>
    </div>
  );
}

export function CompetitorsCard({ onChanged }: { onChanged?: () => void }) {
  const [competitors, setCompetitors] = useState<CompetitorRow[] | null>(null);
  const [playerSuggestions, setPlayerSuggestions] = useState<PlayerSuggestion[]>([]);
  const [hasActiveHypothesis, setHasActiveHypothesis] = useState(false);
  const [addError, setAddError] = useState('');

  function load() {
    fetch('/api/market-data/competitors').then((r) => r.json()).then((body) => {
      setCompetitors(body.competitors ?? []);
      onChanged?.();
    }).catch(() => setCompetitors([]));
    // Prompt 378 §C — competitor proposals come from the DOCUMENT pass
    // (the Competitive_Landscape extraction) as well as from web research;
    // /api/market-data (the panel's own GET) already returns both kinds of
    // pending item, and a document-sourced one carries document_id/page
    // instead of a source_url. Reading them here is what lets the founder
    // review real cards after one "build my portrait" click instead of
    // starting from an empty list.
    //
    // Prompt 448 §A — this route now hides pre-445 web `players` items with
    // no hypothesis_id, so playerSuggestions can legitimately be empty even
    // when research has been done — it just now lives per-hypothesis
    // (Market Thesis section) instead of here. §B fetches active-hypothesis
    // existence separately so the empty state below can tell those two
    // cases apart.
    fetch('/api/market-data').then((r) => r.json()).then((body) => {
      setPlayerSuggestions(((body.researchItems ?? []) as PlayerSuggestion[]).filter((i) => i.section === 'players'));
    }).catch(() => {});
    fetch('/api/market-thesis').then((r) => r.json()).then((body) => {
      setHasActiveHypothesis(((body.hypotheses ?? []) as unknown[]).length > 0);
    }).catch(() => {});
  }
  useEffect(load, []);

  // Prompt 448 §C (client-side counterpart) — this used to derive the
  // competitor name itself (structured.name with a title-strip fallback)
  // and write it via a direct /competitors "add" call, THEN separately call
  // /respond to mark the item accepted. That meant the row was already
  // created — under whatever name this fallback produced — before /respond
  // (the endpoint Prompt 448 §C hardens against exactly this) ever got a
  // say; a bad name could land even with the server-side guard in place,
  // since the guard's 409 only stopped the item's status from flipping, not
  // the row that already existed. Routing straight through /respond removes
  // the duplicate, less-trustworthy code path entirely: naming, dedup
  // against the shared market_companies library, and the competitorType →
  // relation mapping all happen once, server-side, in the branch that's
  // actually guarded.
  async function acceptSuggestionAsCompetitor(item: PlayerSuggestion) {
    const res = await fetch('/api/market-data/research/respond', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: item.id, action: 'accept' }),
    });
    const body = await res.json().catch(() => null);
    if (!body?.ok) { setAddError(body?.error ?? 'Could not add this competitor.'); return; }
    setAddError('');
    load();
  }

  if (competitors === null) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Each competitor is a real card — identity, money, positioning, and life signal — always with a source, shared
        across every startup on the platform (never duplicated per org).
      </p>
      {playerSuggestions.length > 0 && (
        <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Proposed — review and add as a competitor card</p>
          {playerSuggestions.map((s) => (
            <div key={s.id} className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 text-gray-700">
                <span className="truncate">{s.title.replace(/^Competitor:\s*/i, '')}</span>
                {/* §C — say plainly whether this came from the founder's own
                    document or from the web; they weigh them differently. */}
                <span className="ml-1 text-[10px] text-gray-400">
                  {s.document_id ? `from your own document${s.page != null ? `, p. ${s.page}` : ''}` : 'from web research'}
                </span>
              </span>
              <button onClick={() => acceptSuggestionAsCompetitor(s)} className="shrink-0 rounded-lg bg-[#0E7490] px-2 py-0.5 text-white">Add</button>
            </div>
          ))}
        </div>
      )}
      {/* Prompt 448 §B — same bridge copy ResearchSectionPanel has shown
          since 445 (MarketDataPanel.tsx), reused verbatim rather than
          invented fresh: research now runs per hypothesis, so an empty
          suggestion list with an active hypothesis means "go research
          there", not "nothing was ever found". */}
      {playerSuggestions.length === 0 && hasActiveHypothesis && (
        <p className="text-xs text-gray-500">
          Research now runs per market hypothesis, grounded on your Market Thesis instead of raw sector tags — open a
          hypothesis card above (Market Thesis) and research competitors from there.
        </p>
      )}
      {addError && <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-[#B00000]">{addError}</p>}
      {competitors.map((c) => <CompetitorCard key={c.id} c={c} onChanged={load} />)}
      <AddCompetitorForm onAdded={load} />
    </div>
  );
}
