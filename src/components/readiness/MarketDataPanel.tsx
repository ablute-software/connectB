'use client';
// Prompt 360 Part A — "Market data": three sources on one founder-curated
// canvas. company-knowledge.ts's own closed source list is unchanged by
// this feature — a founder who accepts a research item gets a real
// company_claims row (feeding Blueprint/mini-pitch through the EXISTING,
// already-audited claims pipeline), not a new investor-facing path.
//
// Prompt 370 — "the app already read the data room; the founder reviews
// and accepts, never starts from a blank form." Two additions on top of
// 360's original three sources: (B) honest three-state empty messaging —
// "not read yet" is never presented as "nothing found" — and (C) "Read my
// documents", a founder-picked, focused AI pass over Vault documents that
// turns them into the SAME accept/edit/reject proposals research items
// already use, pre-filling "Added by you" instead of leaving it blank.
//
// Prompt 373 §0.1 — REVOKES the prior "never investor-facing" rule (Nuno,
// 2026-08-25). The CLAUDE.md root privacy rule is untouched by this: it
// bans performance the PLATFORM derives about the founder (passes, outreach
// counts, pipeline stats — observation about them, never theirs to give),
// never content the founder themselves researches and writes. Market
// analysis is squarely the second kind, same as a pitch deck — so it now
// goes behind the founder's own publish toggle (§F, one group at a time,
// closed by default — see MarketPublishToggle.tsx and migration 0246's own
// header for the full reasoning). Do not read the absence of a blanket ban
// here as a bug.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { PlanBadge } from '@/components/PlanBadge';
import { browserClient } from '@/lib/supabase';
import { marketDataEmptyState } from '@/lib/market-data-gate';
import { MarketRingsCard } from './market/MarketRingsCard';
import { CompetitorsCard } from './market/CompetitorsCard';
import { InvestorBridgeCard } from './market/InvestorBridgeCard';
import { InvestorLensCard } from './market/InvestorLensCard';
import { MarketPublishToggle } from './market/MarketPublishToggle';
import { SectionResearchButtons, SECTION_LABEL as RESEARCH_SECTION_LABEL, type SectionOutcome } from './market/SectionResearchButtons';
import { MarketPortraitCard } from './market/MarketPortraitCard';
import { PORTRAIT_DOC_HEURISTIC, MAX_PORTRAIT_DOCS } from '@/lib/market-portrait';

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
  source_kind?: 'web' | 'document'; document_id?: string | null; page?: number | null;
}
interface DocCounts { docsTotal: number; docsReadable: number; docsExtracted: number; docsWithMarketContent: number }
interface VaultDoc { id: string; name: string; folderName: string }

const SECTION_LABEL: Record<string, string> = {
  definition: 'Definition & scope', sizing: 'Market size', growth: 'Growth', players: 'Competitors',
  rounds: 'Comparable rounds', trends: 'Trends & drivers', regulatory: 'Regulatory', segments: 'Segments',
};

const BLANK_ADDED: AddedByYou = {
  market_size_value_eur: null, market_size_scope: null, market_size_year: null, market_size_source: null,
  growth_pct: null, segments: [], competitors: [], free_sources: [],
};

// Prompt 370 §C1 — the pre-selection heuristic: name/folder likely to hold
// market material. A disclosed false-negative-only guess (same discipline
// as the server's own MARKET_HEURISTIC in market-data/route.ts) — the
// founder can add or remove any document from the picker regardless.
// Prompt 378 §D — now the SAME regex the server-side portrait pass uses
// (market-portrait.ts), imported rather than a second copy that drifts.
const DOC_PRESELECT_HEURISTIC = PORTRAIT_DOC_HEURISTIC;
const MAX_DOCUMENT_PASS = MAX_PORTRAIT_DOCS;

export function MarketDataPanel() {
  const [gate, setGate] = useState<Gate | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [added, setAdded] = useState<AddedByYou>(BLANK_ADDED);
  const [savingAdded, setSavingAdded] = useState(false);
  const [researchItems, setResearchItems] = useState<ResearchItem[] | null>(null);
  const [sectionOutcome, setSectionOutcome] = useState<SectionOutcome | null>(null);
  // Prompt 378 §D — cold start / dead-card suppression. Counts come from the
  // rings + competitors routes so a card with nothing behind it can be
  // replaced by a single line instead of rendering as an empty box.
  const [ringCount, setRingCount] = useState<number | null>(null);
  const [competitorCount, setCompetitorCount] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [docCounts, setDocCounts] = useState<DocCounts | null>(null);

  // Prompt 370 §C — "Read my documents" picker state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [vaultDocs, setVaultDocs] = useState<VaultDoc[] | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extractCost, setExtractCost] = useState<number | null>(null);

  function load() {
    fetch('/api/market-data').then((r) => r.json()).then((body) => {
      if (!body.available) { setNotAvailable(true); return; }
      setGate(body.gate ?? null);
      setDocs(body.fromYourDocuments ?? []);
      if (body.addedByYou) setAdded({ ...BLANK_ADDED, ...body.addedByYou });
      setResearchItems(body.researchItems ?? []);
      setDocCounts(body.docCounts ?? null);
    }).catch(() => {});
    // Prompt 378 §D — how much material actually exists, so the dependent
    // cards can render a one-line "what's missing" instead of an empty box.
    fetch('/api/market-data/rings').then((r) => r.json())
      .then((b) => setRingCount((b.rings ?? []).length)).catch(() => setRingCount(0));
    fetch('/api/market-data/competitors').then((r) => r.json())
      .then((b) => setCompetitorCount((b.competitors ?? []).length)).catch(() => setCompetitorCount(0));
  }
  useEffect(load, []);

  async function openPicker() {
    setPickerOpen(true); setExtractError(''); setExtractCost(null);
    if (!vaultDocs) {
      const sb = browserClient();
      const [{ data: docRows }, { data: folderRows }] = await Promise.all([
        sb.from('documents').select('id, name, folder_id'),
        sb.from('folders').select('id, name'),
      ]);
      const folderNameById = new Map(((folderRows ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));
      const list = ((docRows ?? []) as { id: string; name: string; folder_id: string | null }[]).map((d) => ({
        id: d.id, name: d.name, folderName: d.folder_id ? folderNameById.get(d.folder_id) ?? '' : '',
      }));
      setVaultDocs(list);
      setSelectedDocIds(list.filter((d) => DOC_PRESELECT_HEURISTIC.test(d.name) || DOC_PRESELECT_HEURISTIC.test(d.folderName))
        .slice(0, MAX_DOCUMENT_PASS).map((d) => d.id));
    }
  }

  function toggleDoc(id: string) {
    setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, MAX_DOCUMENT_PASS)));
  }

  async function runDocumentExtraction() {
    setExtracting(true); setExtractError(''); setExtractCost(null);
    try {
      const res = await fetch('/api/market-data/document-extract', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds: selectedDocIds }),
      });
      const body = await res.json();
      if (!body.ok) { setExtractError(body.error ?? 'Could not read those documents — try again.'); return; }
      setExtractCost(body.costEur ?? 0);
      setPickerOpen(false);
      load();
    } catch {
      setExtractError('Could not read those documents — try again.');
    } finally { setExtracting(false); }
  }

  async function saveAdded() {
    setSavingAdded(true);
    try {
      await fetch('/api/market-data', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(added),
      });
    } finally { setSavingAdded(false); }
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
        Closed by default — nothing here reaches an investor until you publish it, group by group, below. Everything you
        publish shows exactly as you see it, sources included.
      </p>
      <MarketPublishToggle />

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
          {/* Prompt 378 §D — the first move, above everything else on a cold
              start; afterwards it stays as the quieter "re-read documents". */}
          <MarketPortraitCard coldStart={ringCount === 0 && competitorCount === 0} onDone={load} />

          <Card title="From your documents">
            {/* Prompt 370 §B — three honest states. State 1 is the exact
                false negative the founder caught: "nothing found" implied
                the app had looked and found nothing, when the truth was it
                had never read the documents at all (all 67 sat
                malware_scan_status='not_scanned', pre Prompt 369's
                retro-scan). Never collapse these two into one message
                again. */}
            {(() => { const emptyState = marketDataEmptyState(docCounts, docs.length); return emptyState === 'not_read' ? (
              <p className="text-xs text-amber-700">
                Your {docCounts?.docsTotal} document{docCounts?.docsTotal === 1 ? '' : 's'} {docCounts?.docsTotal === 1 ? "hasn't" : "haven't"} been read yet
                (awaiting security scan/extraction) — this isn&apos;t &quot;nothing found,&quot; it&apos;s &quot;not looked at yet.&quot;
                {' '}Use <span className="font-medium">Read my documents</span> below for a focused pass on whichever ones you pick.
              </p>
            ) : emptyState === 'nothing_found' ? (
              <p className="text-xs text-gray-400">
                Nothing market-related found in the {docCounts?.docsExtracted} document{docCounts?.docsExtracted === 1 ? '' : 's'} already read.
                {' '}Point at specific documents with <span className="font-medium">Read my documents</span> below.
              </p>
            ) : emptyState === 'no_documents' ? (
              <p className="text-xs text-gray-400">No documents in your Vault yet.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-gray-500">Already extracted from your Vault — no new reading, no new cost.</p>
                <ul className="space-y-1.5">
                  {docs.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-700">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{d.documentName}</span>
                      {d.label}
                    </li>
                  ))}
                </ul>
              </>
            ); })()}

            {/* Prompt 370 §C — "Read my documents": the app assembles the
                market picture from what's already in the Vault instead of
                waiting for the founder to type it item by item. Always
                available, not gated on the three states above — a founder
                with plenty in "From your documents" may still want a
                focused re-read of one specific new upload. */}
            <div className="mt-3 border-t border-gray-100 pt-3">
              {!pickerOpen ? (
                <button onClick={openPicker} className="rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8]">
                  📄 Read my documents
                </button>
              ) : (
                <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-gray-800">Read my documents</h4>
                    <button onClick={() => setPickerOpen(false)} className="text-xs text-gray-400 hover:underline">Close</button>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Pre-selected by name/folder — add or remove any document. Up to {MAX_DOCUMENT_PASS} per pass.
                  </p>
                  {vaultDocs === null ? (
                    <p className="mt-2 text-xs text-gray-400">Loading your Vault…</p>
                  ) : vaultDocs.length === 0 ? (
                    <p className="mt-2 text-xs text-gray-400">No documents in your Vault yet.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {vaultDocs.map((d) => (
                        <button key={d.id} onClick={() => toggleDoc(d.id)}
                          className={`rounded-full border px-2 py-1 text-[11px] ${selectedDocIds.includes(d.id) ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
                          {d.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {extractError && <p className="mt-2 text-xs text-[#B00000]">{extractError}</p>}
                  <button disabled={extracting || selectedDocIds.length === 0} onClick={runDocumentExtraction}
                    className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                    {extracting ? 'Reading…' : `Read ${selectedDocIds.length || ''} document${selectedDocIds.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              )}
              {extractCost !== null && (
                <p className="mt-1.5 text-[11px] text-gray-400">Last pass cost ≈ €{extractCost.toFixed(3)}.</p>
              )}
            </div>

            {researchItems && researchItems.some((i) => i.source_kind === 'document') && (
              <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Proposed from your documents — review before accepting</p>
                {researchItems.filter((i) => i.source_kind === 'document').map((item) => (
                  <div key={item.id} className="rounded-lg border border-gray-200 p-2.5">
                    <p className="text-[10px] font-medium uppercase text-gray-400">{SECTION_LABEL[item.section] ?? item.section}</p>
                    <p className="mt-0.5 text-sm text-gray-800">{item.title}</p>
                    {item.detail && <p className="mt-0.5 text-xs text-gray-500">{item.detail}</p>}
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {docs.find((d) => d.documentId === item.document_id)?.documentName ?? 'Vault document'}
                      {item.page ? `, page ${item.page}` : ''}
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <button disabled={busyId === item.id} onClick={() => respond(item.id, 'accept')}
                        className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                        Accept ✓
                      </button>
                      <button disabled={busyId === item.id} onClick={() => respond(item.id, 'reject')}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
            {/* Prompt 370 — this card is web research only; document-sourced
                proposals render in "From your documents" above, where the
                founder is already looking at what came from the Vault.
                Prompt 373 §D — one button per section, cost shown up front
                (from real platform history) and reported after each run. */}
            <SectionResearchButtons onDone={(outcome) => { setSectionOutcome(outcome); load(); }} />
            {/* Prompt 378 §A — the three outcomes, all visible. No click ever
                ends with the screen unchanged. */}
            {sectionOutcome && (
              <div className={`mt-2 rounded-lg border px-2.5 py-2 text-xs ${
                sectionOutcome.kind === 'error' ? 'border-red-200 bg-red-50 text-[#B00000]'
                  : sectionOutcome.kind === 'empty' ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                <span className="font-medium">{RESEARCH_SECTION_LABEL[sectionOutcome.section]}:</span>{' '}
                {sectionOutcome.kind === 'error' ? sectionOutcome.message
                  : sectionOutcome.kind === 'empty'
                    ? `nothing with a verifiable source found in this section${sectionOutcome.costEur != null ? ` · €${sectionOutcome.costEur.toFixed(3)} spent` : ''}.`
                    : `${sectionOutcome.count} item${sectionOutcome.count === 1 ? '' : 's'} found${sectionOutcome.costEur != null ? ` · €${sectionOutcome.costEur.toFixed(3)}` : ''}.`}
              </div>
            )}
            {(() => { const webItems = (researchItems ?? []).filter((i) => i.source_kind !== 'document'); return (
            <>
            {researchItems !== null && webItems.length === 0 && !sectionOutcome && (
              <p className="mt-2 text-xs text-gray-400">No pending suggestions — click a section above to research it.</p>
            )}
            {webItems.length > 0 && (
              <div className="mt-3 space-y-2">
                {webItems.map((item) => (
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
            </>
            ); })()}
          </Card>

          <Card title="Market rings">
            <MarketRingsCard onChanged={load} />
          </Card>

          <Card title="Competitors">
            <CompetitorsCard onChanged={load} />
          </Card>

          {/* Prompt 378 §D — a card with nothing behind it is a dead box, not
              a feature. The bridge needs competitors (with known investors)
              and the lens needs rings or competitors to reason about; until
              then each is ONE line naming the missing step, not an empty
              card pretending to be content. */}
          {competitorCount === 0 ? (
            <p className="text-xs text-gray-400">
              <span className="font-medium text-gray-500">Investors of your competitors:</span> add competitors above first —
              their known investors are what this bridges into your pipeline.
            </p>
          ) : (
            <Card title="Investors of your competitors → your pipeline">
              <InvestorBridgeCard />
            </Card>
          )}

          {ringCount === 0 && competitorCount === 0 ? (
            <p className="text-xs text-gray-400">
              <span className="font-medium text-gray-500">The investor&apos;s lens:</span> once you have rings or competitors,
              this says what an investor will ask about them.
            </p>
          ) : (
            <Card title="The investor's lens">
              <InvestorLensCard />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
