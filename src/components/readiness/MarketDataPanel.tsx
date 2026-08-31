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
//
// Prompt 384 — "muita informação, pouco focada." Splits this one long
// stacked column into two sub-views: Market analysis (the REPORT — what
// answers an investor's "do you understand your market, and how will you
// take it" per §0) and Research (the WORKSHOP — where the founder produces
// and curates raw material). Cold start (no rings, no competitors) opens on
// Research, since there's no report yet to show; otherwise Analysis.
// Nothing about data/API/auth changes here — every card below is the exact
// same component with the exact same props, just re-homed and, for
// Research, shown one section at a time instead of all at once.
import { useEffect, useMemo, useState } from 'react';
import { ReconciliationBusyNotice } from './ReconciliationBusyNotice';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { browserClient } from '@/lib/supabase';
import { marketDataEmptyState } from '@/lib/market-data-gate';
import { MarketRingsCard } from './market/MarketRingsCard';
import { CompetitorsCard } from './market/CompetitorsCard';
import { ComparableRoundsCard } from './market/ComparableRoundsCard';
import { InvestorBridgeCard } from './market/InvestorBridgeCard';
import { InvestorLensCard } from './market/InvestorLensCard';
import { MarketPublishToggle } from './market/MarketPublishToggle';
import { type SectionOutcome } from './market/SectionResearchButtons';
import { MarketPortraitCard } from './market/MarketPortraitCard';
import { MarketThesisSection } from './market/MarketThesisSection';
import { MarketFactsCard } from './market/MarketFactsCard';
import { PORTRAIT_DOC_HEURISTIC, MAX_PORTRAIT_DOCS } from '@/lib/market-portrait';
import { extractionSkipReasonMessage, extractionSummarySentence } from '@/lib/extraction-skip-reason';
import type { ExtractionSkipReason } from '@/lib/document-extraction-pipeline';
import { feedDocumentsToRestOfPlatform } from '@/lib/feed-documents-to-platform';

interface Gate { eligible: boolean; missing: { key: string; label: string; href: string }[] }
interface DocItem { documentId: string; documentName: string; label: string }
interface AddedByYou {
  market_size_value_eur: number | null; market_size_scope: string | null; market_size_year: number | null;
  market_size_source: string | null; growth_pct: number | null;
  segments: string[]; free_sources: { label: string; url: string }[];
  approach_note: string | null;
}
interface ResearchItem {
  id: string; section: string; title: string; detail: string; source_url: string | null; confidence: string | null;
  source_kind?: 'web' | 'document'; document_id?: string | null; page?: number | null;
  // Prompt 463 §A — resolved server-side, straight from `documents`; never
  // re-derived here from `docs` (fromYourDocuments), which doesn't cover
  // every document a research item can point to.
  documentName?: string | null;
}
interface DocCounts { docsTotal: number; docsReadable: number; docsExtracted: number; docsWithMarketContent: number }
interface VaultDoc { id: string; name: string; folderName: string }
// Prompt 484 §2 — the shape /api/market-data/document-extract actually
// returns, so a missing field is a compile error rather than a silent
// `undefined ?? 0`.
interface ExtractResponse {
  ok?: boolean;
  error?: string;
  readDocuments?: { id: string; name: string }[];
  itemsProposed?: number;
  itemsEnriched?: number;
  competitorsBackfilled?: number;
  costEur?: number;
  skipped?: { documentId: string; reason: ExtractionSkipReason }[];
  truncated?: boolean;
  // Prompt 486 — counts per stage, so a pass that changes nothing can say
  // whether the model reported nothing, the parser dropped everything, or
  // every item collided with a row that already exists.
  telemetry?: Record<string, unknown> | null;
}
// Prompt 463 §B.2 — what a "Read my documents" pass actually did, so the
// panel can say so in words instead of the old bare "Last pass cost"
// number (which was itself the only acknowledgement a pass had happened at
// all).
interface ExtractSummary {
  readDocuments: { id: string; name: string }[];
  itemsProposed: number;
  // Prompt 482 — rows that already existed and now carry a classification.
  // Kept apart from itemsProposed on purpose: "3 new proposals below" sends
  // the founder to the list to decide; "3 existing suggestions now
  // classified" tells them something they already saw just got better.
  itemsEnriched: number;
  // Prompt 483 — competitors the founder had ALREADY accepted whose
  // classification only arrived now. A third distinct statement, not a
  // variant of the other two.
  competitorsBackfilled: number;
  costEur: number;
  skipped: { documentId: string; reason: ExtractionSkipReason }[];
  // Prompt 464 §B — filled in once the serial per-document pass below
  // finishes; null while it's still running or hasn't started (rendered as
  // the separate feedingProgress line instead).
  platformFeedNote: string | null;
}
// Prompt 464 §B.3 / Prompt 465 §C — the real, named progress this
// codebase's own North Star invariant 11 requires in place of a mute
// spinner, reused across the two sequential phases a "Read my documents"
// pass now runs client-side: reading each document ("Reading 'X' for the
// rest of the platform… (i of n)"), then the single, org-level
// reconciliation call that follows it ("Updating what Sherlock knows…").
type FeedingProgress = { kind: 'reading'; name: string; index: number; total: number } | { kind: 'reconciling' };

const APPROACH_MAX_LEN = 600;

const BLANK_ADDED: AddedByYou = {
  market_size_value_eur: null, market_size_scope: null, market_size_year: null, market_size_source: null,
  growth_pct: null, segments: [], free_sources: [], approach_note: null,
};

// Prompt 370 §C1 — the pre-selection heuristic: name/folder likely to hold
// market material. A disclosed false-negative-only guess (same discipline
// as the server's own MARKET_HEURISTIC in market-data/route.ts) — the
// founder can add or remove any document from the picker regardless.
// Prompt 378 §D — now the SAME regex the server-side portrait pass uses
// (market-portrait.ts), imported rather than a second copy that drifts.
const DOC_PRESELECT_HEURISTIC = PORTRAIT_DOC_HEURISTIC;
const MAX_DOCUMENT_PASS = MAX_PORTRAIT_DOCS;

// Prompt 460 — narrowed from `Section | 'documents' | 'added'`: with
// players/rounds gone from ResearchMenu too (§A), nothing can ever set
// this to a Section value anymore — a wider type here would describe
// states the UI can no longer reach.
type ResearchMenuKey = 'documents' | 'added';

export function MarketDataPanel() {
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
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
  const [extractSummary, setExtractSummary] = useState<ExtractSummary | null>(null);
  const [feedingProgress, setFeedingProgress] = useState<FeedingProgress | null>(null);

  // Prompt 384 §A — the two sub-views. `view` starts undecided and resolves
  // once ringCount/competitorCount are known (cold start -> Research,
  // otherwise -> Market analysis) — never flips again after that first
  // resolution, so a founder who publishes their first ring mid-session
  // isn't yanked out of the tab they're actively working in.
  const [view, setView] = useState<'analysis' | 'research' | null>(null);
  const [researchKey, setResearchKey] = useState<ResearchMenuKey>('documents');

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

  useEffect(() => {
    if (view !== null || ringCount === null || competitorCount === null) return;
    setView(ringCount === 0 && competitorCount === 0 ? 'research' : 'analysis');
  }, [view, ringCount, competitorCount]);

  async function openPicker() {
    setPickerOpen(true); setExtractError(''); setExtractSummary(null); setFeedingProgress(null);
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
    setExtracting(true); setExtractError(''); setExtractSummary(null); setFeedingProgress(null);
    try {
      const res = await fetch('/api/market-data/document-extract', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds: selectedDocIds }),
      });
      // Prompt 484 §2 — this used to be a bare `await res.json()`. When the
      // route died on the platform's 60s ceiling the response was a Vercel
      // error page, not JSON, so `res.json()` threw and the whole thing fell
      // into the outer catch — which shows the same generic sentence as a
      // structured `{ok:false, error}` from the route. Two completely
      // different failures, one indistinguishable message, and nothing in the
      // console to tell them apart. That is why the 31/08 failures could not
      // be diagnosed from the browser at all. The founder-facing text is
      // unchanged; what is new is that each of the three cases now says which
      // one it was.
      const raw = await res.text();
      let body: ExtractResponse | null = null;
      try { body = JSON.parse(raw) as ExtractResponse; } catch { body = null; }
      if (!body) {
        console.error('[document-extract] response was not JSON — the function probably died before it could answer', {
          status: res.status, statusText: res.statusText, bodyStart: raw.slice(0, 500),
        });
        setExtractError('Could not read those documents — try again.');
        return;
      }
      if (!body.ok) {
        console.error('[document-extract] the route answered with a failure', { status: res.status, error: body.error ?? '(no error field)' });
        setExtractError(body.error ?? 'Could not read those documents — try again.');
        return;
      }
      // Prompt 463 §B.2/§B.3 — never leave the screen without saying what
      // just happened (North Star invariant 11): which documents were
      // actually read, how many proposals resulted, and — by name — which
      // documents were skipped and why, instead of the old bare cost figure
      // that was the only sign anything had happened at all.
      const readDocuments = body.readDocuments ?? [];
      setExtractSummary({
        readDocuments,
        itemsProposed: body.itemsProposed ?? 0,
        itemsEnriched: body.itemsEnriched ?? 0,
        competitorsBackfilled: body.competitorsBackfilled ?? 0,
        costEur: body.costEur ?? 0,
        skipped: body.skipped ?? [],
        platformFeedNote: null,
      });
      // Prompt 486 — always logged, including (especially) on a pass that
      // changed nothing: that is the case with no other trace anywhere.
      if (body.telemetry) console.info('[document-extract] telemetry', body.telemetry);
      setPickerOpen(false);
      load();

      // Prompt 464 §B — the Prompt 463 §C fire-and-forget after `return`
      // never actually ran in production (a frozen serverless instance
      // gets no more CPU once its response is sent). Replaced with a real,
      // awaited, client-driven call per document against the SAME route
      // store-supabase.tsx already calls after an upload
      // (/api/data-room/extract-document) — in series, never parallel,
      // since each call reads a whole PDF and pays a real model request.
      // Already cached by (document_id, sha256) inside extractDocument
      // itself, so this can run on every pass with no special condition:
      // an already-extracted document returns immediately at no cost.
      const failures = await feedDocumentsToRestOfPlatform(
        readDocuments,
        async (documentId) => {
          try {
            const feedRes = await fetch('/api/data-room/extract-document', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId }),
            });
            const feedBody = await feedRes.json().catch(() => null);
            return { ok: !!feedBody?.ok, skippedReason: feedBody?.skippedReason };
          } catch {
            return { ok: false };
          }
        },
        (p) => setFeedingProgress({ kind: 'reading', ...p }),
      );

      // Prompt 465 §C — the SAME two dead void triggers §A just removed
      // used to be the only thing that could reconcile a fresh reading
      // against the founder's claims. This is their real replacement: one
      // explicit, awaited call, org-level (never per-document — reconciling
      // N times for N documents in the same pass would be pure waste, the
      // engine already looks at the whole org's claims/Vault together).
      setFeedingProgress({ kind: 'reconciling' });
      const reconcileBody = await fetch('/api/reconciliation/run', { method: 'POST' })
        .then((r) => r.json()).catch(() => null) as
        { ok?: boolean; ran?: boolean; autoLinked?: number; suggested?: number; reconciliationSkipped?: boolean } | null;
      setFeedingProgress(null);
      // Prompt 480 §6 — this panel is the fourth surface that can hit the
      // org lock, but it reaches reconciliation through
      // /api/reconciliation/run rather than /api/blueprint (which it never
      // calls), so the flag arrives on THIS response instead. Same notice,
      // same wording, different route.
      setReconciliationBusy(!!reconcileBody?.reconciliationSkipped);

      // Prompt 465 §C — three states, not two: `ran: true` means "the
      // reconciliation engine executed," not "something changed" — it can
      // run and correctly conclude nothing needs updating. Never claims
      // more than the backend proved (same rule as 464's own "never says
      // profile"): "updated" only when autoLinked+suggested>0, "checked"
      // when it ran and found nothing, the plain base sentence (+ a retry
      // notice only on a REAL error) when it didn't run at all.
      const reconcileOk = !!reconcileBody?.ok;
      const reconcileChanged = reconcileOk && !!reconcileBody?.ran && ((reconcileBody?.autoLinked ?? 0) + (reconcileBody?.suggested ?? 0)) > 0;
      const reconcileRanNoChange = reconcileOk && !!reconcileBody?.ran && !reconcileChanged;
      const errorClause = reconcileOk ? '' : ' Could not update everything it knows — this will be retried.';

      // Never silence (North Star invariant 11): names every document that
      // failed to read, using the route's own skippedReason (mapped
      // through the same sentence extraction-skip-reason.ts already
      // provides) when there is one, a fixed clause otherwise.
      let platformFeedNote: string;
      if (failures.length === 0) {
        const suffix = reconcileChanged ? ' and updated what it knows.' : reconcileRanNoChange ? ' and checked what it knows.' : '.';
        platformFeedNote = `Sherlock finished reading these documents${suffix}${errorClause}`;
      } else {
        const failureText = failures.map((f) => `"${f.name}" could not be read in full`
          + `${f.skippedReason ? ` — ${extractionSkipReasonMessage(f.skippedReason as ExtractionSkipReason)}` : ''}.`).join(' ');
        const reconcileSentence = reconcileChanged ? ' Sherlock also updated what it knows.' : reconcileRanNoChange ? ' Sherlock also checked what it knows.' : '';
        platformFeedNote = `${failureText}${reconcileSentence}${errorClause}`;
      }
      setExtractSummary((prev) => (prev ? { ...prev, platformFeedNote } : prev));
    } catch (e) {
      // Reached only when the request itself failed (no response at all), or
      // when something after a successful read threw — never any more for a
      // non-JSON response, which is handled above with its own log line.
      console.error('[document-extract] the pass threw before it could finish', e);
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
      // Prompt 384 §E.2 — a `players` accept now creates a real competitor
      // card server-side; reload counts so the "Only you"/cold-start gates
      // and the Competitors card itself pick it up immediately.
      load();
    } finally { setBusyId(null); }
  }

  const pendingDocuments = useMemo(() => (researchItems ?? []).filter((i) => i.source_kind === 'document').length, [researchItems]);

  if (notAvailable) return <p className="text-sm text-gray-400">Not available in this workspace yet.</p>;
  if (!gate || view === null) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="max-w-5xl space-y-4">
      <ReconciliationBusyNotice show={reconciliationBusy} />
      <p className="text-xs text-gray-500">
        Closed by default — nothing here reaches an investor until you publish it, group by group, below. Everything you
        publish shows exactly as you see it, sources included.
      </p>

      {/* Prompt 444 §F — above everything else, and deliberately outside
          the gate.eligible frost below: filling this in is often itself
          the missing basic, so it can't sit behind the gate it helps
          unlock. */}
      <MarketThesisSection />

      {gate.eligible && (
        <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs">
          <button onClick={() => setView('analysis')}
            className={`px-3 py-1.5 font-medium ${view === 'analysis' ? 'bg-[#0E7490] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            Market analysis
          </button>
          <button onClick={() => setView('research')}
            className={`px-3 py-1.5 font-medium ${view === 'research' ? 'bg-[#0E7490] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            Research
          </button>
        </div>
      )}

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
          {view === 'analysis' ? (
            <MarketAnalysisView
              added={added} setAdded={setAdded} savingAdded={savingAdded} saveAdded={saveAdded}
              ringCount={ringCount} competitorCount={competitorCount} load={load}
            />
          ) : (
            <ResearchView
              researchKey={researchKey} setResearchKey={setResearchKey}
              pendingDocuments={pendingDocuments}
              ringCount={ringCount} competitorCount={competitorCount} load={load}
              docs={docs} docCounts={docCounts} researchItems={researchItems}
              pickerOpen={pickerOpen} openPicker={openPicker} setPickerOpen={setPickerOpen}
              vaultDocs={vaultDocs} selectedDocIds={selectedDocIds} toggleDoc={toggleDoc}
              extracting={extracting} extractError={extractError} extractSummary={extractSummary} feedingProgress={feedingProgress}
              runDocumentExtraction={runDocumentExtraction}
              added={added} setAdded={setAdded} savingAdded={savingAdded} saveAdded={saveAdded}
              busyId={busyId} respond={respond}
              sectionOutcome={sectionOutcome} setSectionOutcome={setSectionOutcome}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt 384 §B — Market analysis: the report. Order per §B: publish toggle,
// Market rings + Competitors (curated), Comparable rounds (new), the
// founder's own "How we'll take it" note (new), then a clearly-separated
// "Only you see this" zone for the outreach-strategy tools.
function MarketAnalysisView({ added, setAdded, savingAdded, saveAdded, ringCount, competitorCount, load }: {
  added: AddedByYou; setAdded: (a: AddedByYou) => void; savingAdded: boolean; saveAdded: () => void;
  ringCount: number | null; competitorCount: number | null; load: () => void;
}) {
  return (
    <>
      <MarketPublishToggle />

      <Card title="Market rings">
        <MarketRingsCard onChanged={load} />
      </Card>

      <Card title="Competitors">
        <CompetitorsCard onChanged={load} />
      </Card>

      <Card title="Comparable rounds">
        <ComparableRoundsCard />
      </Card>

      <Card title="How we'll take it">
        <p className="mb-2 text-xs text-gray-500">
          Your own answer to how you&apos;ll approach this market and in what timeframe — the half of the story no ring or
          number tells on its own. Shown to investors alongside Market rings when that group is published.
        </p>
        <textarea value={added.approach_note ?? ''} maxLength={APPROACH_MAX_LEN}
          onChange={(e) => setAdded({ ...added, approach_note: e.target.value })}
          rows={4} placeholder="e.g. We start in the Ring 1 buyer (hospital procurement in Portugal/Spain), land 3 lighthouse accounts in 12 months, then expand to Ring 2 via their own referrals."
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">{(added.approach_note ?? '').length}/{APPROACH_MAX_LEN}</span>
          <button disabled={savingAdded} onClick={saveAdded}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {savingAdded ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Card>

      <div className="border-t border-dashed border-gray-200 pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Only you see this — outreach strategy</p>
        <p className="mb-3 text-[11px] text-gray-400">Nothing below is publishable — these are your own tools for approaching investors, not market analysis.</p>

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
          <p className="mt-3 text-xs text-gray-400">
            <span className="font-medium text-gray-500">The investor&apos;s lens:</span> once you have rings or competitors,
            this says what an investor will ask about them.
          </p>
        ) : (
          <div className="mt-3">
            <Card title="The investor's lens">
              <InvestorLensCard />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Prompt 384 §C — Research: one section at a time, left menu (mirrors
// CompanySubMenu's visual language — chips on mobile, a block list on
// desktop — but selection-driven rather than scrollspy: the content column
// only ever renders the ONE active section, per §C.2's own "conteúdo à
// direita, uma secção de cada vez").
function ResearchMenu({ researchKey, setResearchKey, pendingDocuments }: {
  researchKey: ResearchMenuKey; setResearchKey: (k: ResearchMenuKey) => void;
  pendingDocuments: number;
}) {
  // Prompt 460 — players/rounds dropped too: like the other 5 sections
  // removed in 458, they had no real content of their own in THIS menu —
  // CompetitorsCard/ComparableRoundsCard live in the separate Market
  // analysis tab. MarketThesisSection (always visible above this tab) is
  // the one real path to research for all 7 sections; this menu is now
  // only ever the two panels with actual content here.
  const items: { key: ResearchMenuKey; label: string; badge?: number }[] = [
    { key: 'documents' as const, label: 'From your documents', badge: pendingDocuments || undefined },
    { key: 'added' as const, label: 'Added by you' },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 lg:block lg:w-48 lg:shrink-0 lg:space-y-0.5 lg:overflow-visible lg:pb-0">
      {items.map((it) => (
        <button key={it.key} onClick={() => setResearchKey(it.key)}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-left text-xs font-medium lg:w-full lg:rounded-lg ${
            researchKey === it.key ? 'bg-[#E8F4F8] text-[#0E7490]' : 'border border-gray-200 text-gray-600 hover:bg-gray-50 lg:border-0'}`}>
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
          {!!it.badge && (
            <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${researchKey === it.key ? 'bg-[#0E7490] text-white' : 'bg-gray-200 text-gray-600'}`}>
              {it.badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

const SECTION_LABEL: Record<string, string> = {
  definition: 'Definition & scope', sizing: 'Market size', growth: 'Growth', players: 'Competitors',
  rounds: 'Comparable rounds', trends: 'Trends & drivers', regulatory: 'Regulatory', segments: 'Segments',
};

function ResearchView(props: {
  researchKey: ResearchMenuKey; setResearchKey: (k: ResearchMenuKey) => void;
  pendingDocuments: number;
  ringCount: number | null; competitorCount: number | null; load: () => void;
  docs: DocItem[]; docCounts: DocCounts | null; researchItems: ResearchItem[] | null;
  pickerOpen: boolean; openPicker: () => void; setPickerOpen: (v: boolean) => void;
  vaultDocs: VaultDoc[] | null; selectedDocIds: string[]; toggleDoc: (id: string) => void;
  extracting: boolean; extractError: string; extractSummary: ExtractSummary | null; feedingProgress: FeedingProgress | null;
  runDocumentExtraction: () => void;
  added: AddedByYou; setAdded: (a: AddedByYou) => void; savingAdded: boolean; saveAdded: () => void;
  busyId: string | null; respond: (id: string, action: 'accept' | 'reject') => void;
  sectionOutcome: SectionOutcome | null; setSectionOutcome: (o: SectionOutcome | null) => void;
}) {
  const { researchKey, setResearchKey, pendingDocuments, load } = props;
  return (
    <div className="space-y-4">
      <MarketPortraitCard coldStart={props.ringCount === 0 && props.competitorCount === 0} onDone={load} />

      <div className="flex flex-col gap-4 lg:flex-row">
        <ResearchMenu researchKey={researchKey} setResearchKey={setResearchKey} pendingDocuments={pendingDocuments} />
        <div className="min-w-0 flex-1">
          {researchKey === 'documents' ? <FromYourDocumentsPanel {...props} />
            : <AddedByYouPanel added={props.added} setAdded={props.setAdded} savingAdded={props.savingAdded} saveAdded={props.saveAdded} />}
        </div>
      </div>
    </div>
  );
}

function FromYourDocumentsPanel({ docs, docCounts, researchItems, pickerOpen, openPicker, setPickerOpen, vaultDocs, selectedDocIds, toggleDoc, extracting, extractError, extractSummary, feedingProgress, runDocumentExtraction, busyId, respond }: {
  docs: DocItem[]; docCounts: DocCounts | null; researchItems: ResearchItem[] | null;
  pickerOpen: boolean; openPicker: () => void; setPickerOpen: (v: boolean) => void;
  vaultDocs: VaultDoc[] | null; selectedDocIds: string[]; toggleDoc: (id: string) => void;
  extracting: boolean; extractError: string; extractSummary: ExtractSummary | null; feedingProgress: FeedingProgress | null;
  runDocumentExtraction: () => void;
  busyId: string | null; respond: (id: string, action: 'accept' | 'reject') => void;
}) {
  const emptyState = marketDataEmptyState(docCounts, docs.length);
  return (
    <Card title="From your documents">
      {/* Prompt 370 §B — three honest states. State 1 is the exact false
          negative the founder caught: "nothing found" implied the app had
          looked and found nothing, when the truth was it had never read the
          documents at all (all 67 sat malware_scan_status='not_scanned',
          pre Prompt 369's retro-scan). Never collapse these two into one
          message again. */}
      {emptyState === 'not_read' ? (
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
          {/* Prompt 463 §B.1 — this caption describes the LIST below, never
              an action: it used to claim "no new reading, no new cost" even
              immediately after a fresh, real, paid extraction pass — the
              founder read "nothing happened" right after something did. */}
          <p className="mb-2 text-xs text-gray-500">Facts already extracted from your Vault.</p>
          <ul className="space-y-1.5">
            {docs.map((d, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-gray-700">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{d.documentName}</span>
                {d.label}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Prompt 370 §C — "Read my documents": the app assembles the market
          picture from what's already in the Vault instead of waiting for
          the founder to type it item by item. Always available, not gated
          on the three states above — a founder with plenty in "From your
          documents" may still want a focused re-read of one specific new
          upload. */}
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
        {/* Prompt 463 §B.2/§B.3 — North Star invariant 11, applied to this
            screen: never leave it without saying what just happened. Before
            this, the only trace of a pass was a bare cost figure — present
            or absent, saying nothing about what was read, what it found, or
            which documents (if any) it couldn't read at all. */}
        {extractSummary && (
          <div className="mt-1.5 space-y-1">
            <p className="text-[11px] text-gray-600">
              {/* Prompt 482 — one tested function instead of a nested
                  ternary here: this exact sentence read "Already read —
                  nothing new" three times in production while three real
                  model runs were being paid for and every proposal was
                  being discarded by a title collision. */}
              {extractionSummarySentence({
                itemsProposed: extractSummary.itemsProposed,
                itemsEnriched: extractSummary.itemsEnriched,
                competitorsBackfilled: extractSummary.competitorsBackfilled,
                documentNames: extractSummary.readDocuments.map((d) => d.name),
              })}
              {extractSummary.costEur > 0 ? ` (≈ €${extractSummary.costEur.toFixed(3)})` : ''}
            </p>
            {extractSummary.skipped.length > 0 && (
              <ul className="space-y-0.5">
                {extractSummary.skipped.map((s) => (
                  <li key={s.documentId} className="text-[11px] text-amber-700">
                    &quot;{vaultDocs?.find((d) => d.id === s.documentId)?.name ?? 'A document'}&quot; — {extractionSkipReasonMessage(s.reason)}.
                  </li>
                ))}
              </ul>
            )}
            {/* Prompt 464 §B / Prompt 465 §C — real, named progress across
                both client-driven phases, never a mute spinner: first each
                document being read into document_extractions, then the
                single org-level reconciliation call that follows. */}
            {feedingProgress && (
              <p className="text-[11px] text-gray-400">
                {feedingProgress.kind === 'reading'
                  ? `Reading "${feedingProgress.name}" for the rest of the platform… (${feedingProgress.index} of ${feedingProgress.total})`
                  : 'Updating what Sherlock knows…'}
              </p>
            )}
            {extractSummary.platformFeedNote && (
              <p className="text-[11px] text-gray-600">{extractSummary.platformFeedNote}</p>
            )}
          </div>
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
                {item.documentName ?? 'Vault document'}
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

      {/* Prompt 467 §D — growth/market_size, document-sourced, no longer
          land in the list above at all (§C cuts them over to typed
          market_facts instead). This is where they surface now, grouped by
          verification_status rather than presented as undifferentiated
          proposal cards. */}
      <MarketFactsCard />
    </Card>
  );
}

// Prompt 384 §E.1 — the competitors editor is GONE from this form (the
// structured flow via CompetitorsCard, Market analysis view, is now the
// only way to add one) — every other field is unchanged.
function AddedByYouPanel({ added, setAdded, savingAdded, saveAdded }: {
  added: AddedByYou; setAdded: (a: AddedByYou) => void; savingAdded: boolean; saveAdded: () => void;
}) {
  return (
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
      <p className="mt-3 text-[11px] text-gray-400">
        Looking for competitors? They&apos;re structured cards now — add them from the Competitors card in Market analysis.
      </p>

      <button disabled={savingAdded} onClick={saveAdded}
        className="mt-3 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
        {savingAdded ? 'Saving…' : 'Save'}
      </button>
    </Card>
  );
}
