'use client';
// Investor Workspace Pipeline (prompt 58) — startups presented in waves by
// match score. Mirrors the founder-side pipeline's doseamento principle:
// only the current wave is actionable, the rest stay locked until it's
// fully treated (every card passed or expressed interest on).
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { ComparisonView } from './ComparisonView';
import { InteractionLogDrawer } from './InteractionLogDrawer';
import { FollowOnBadge } from '../FollowOnBadge';
import type { FollowOnPayload } from '@/lib/network';

const MAX_COMPARE = 3;

// Prompt 189 — measured in the actual render (a scratch element built from
// this file's own collapsed-card markup, at the panel's own max-w-2xl
// width), not guessed: a collapsed card is ~69.6px, not the ~52-60px the
// P134-A comment above estimates. 15 cards + 14 gaps at the list's own
// space-y-3 (12px): 15*69.6 + 14*12 = 1212, rounded. This assumes a single
// flowing wave (the common case) — a wave label (waves.length > 1) or a
// LockedWave block (7 skeleton rows, ~464px) both count as "one item" in
// the same scroll per this prompt's own instruction not to special-case
// them, so the visible count will vary a little around 15 when either
// shows up, the same trade-off the founder-side table (Prompt 188) has
// with its own variable row heights.
const PIPELINE_CARD_LIST_MAX_HEIGHT_PX = 1212;

interface Card {
  orgId: string; name: string; oneLiner: string | null;
  // P134-A — the fuller MatchDeal description, shown only once a row is
  // expanded; the collapsed row keeps the shorter one_liner.
  description: string | null;
  // Prompt 325 — additional to oneLiner/description, absent (not empty
  // string) when the founder hasn't filled it in.
  introProblem?: string; introSolution?: string;
  sectors: string[]; stage: string | null;
  hqCity: string | null; country: string | null; roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: 'pre_money' | 'post_money' | null; roundInstruments: string[];
  matchScore: number; matchReasons: string[]; status: 'open' | 'passed' | 'interested'; passReason: string | null;
  // Item 6 (mini_prompt_itens_5_6) — when the decision was recorded, and
  // whether it was this investor or a teammate at the same firm. Both null
  // for a decision that predates investor_relationship_decisions (a legacy
  // matchdeal_swipes-only signal), never fabricated.
  decidedAt?: string | null; decidedByMe?: boolean | null;
  // P132-A — a real relationship (grant and/or decision) with this
  // investor, independent of whether the startup's MatchDeal profile is
  // published. Drives the "Invited" badge below instead of a wave number —
  // a relationship card was never subject to wave doseamento to begin with.
  viaGrant?: boolean; viaDecision?: boolean;
  // Prompt 318 — a My Network referral this investor accepted. Its own
  // badge ("Referred by X"), distinct from "Invited" — the founder never
  // reached out directly, a mutual contact vouched for the intro.
  viaReferral?: boolean; referredByName?: string | null;
  // Prompt 319 — active follow-on signals for this startup, already masked
  // server-side (shapeFollowOnPayload) — never the investor's own identity
  // when visibility is 'anonymous'.
  followOnSignals?: FollowOnPayload[];
  // Item 8 — same source of truth the Archive tab itself reads
  // (investor_archive_entries, reopened_at is null), not session-local
  // state, so the badge survives a reload just like everything else here.
  isArchived?: boolean;
  trackingCount: number; hasDataRoomAccess: boolean;
}
// Item 14 — a locked wave's `items` now arrives empty from the server
// (/api/portal/pipeline strips real card data for any wave with
// unlocked=false); hiddenCount is the only signal of what's behind it.
interface Wave { index: number; items: Card[]; unlocked: boolean; hiddenCount?: number }
interface PipelineResponse { linked: boolean; waves?: Wave[]; usualCoInvestors?: string | null }

const REASON_MAX_LEN = 1000;
const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };
const STATUS_FILTERS: { value: 'all' | 'open' | 'interested' | 'passed'; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'No decision' }, { value: 'interested', label: 'Interested' }, { value: 'passed', label: 'Passed' },
];

function fmtEur(n: number | null) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

// Item 6 — "not knowing when, or whether, it was submitted" was the actual
// complaint; a date resolves it without reopening AP-06's finality.
function fmtDecidedAt(iso: string | null | undefined, decidedByMe: boolean | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const who = decidedByMe == null ? '' : decidedByMe ? ' by you' : ' by a colleague at your firm';
  return ` on ${date}${who}`;
}

// Item 14 — replaces the old opacity-50 treatment, which left the real
// (locked) card data sitting in the DOM, readable and selectable — the
// server no longer sends that data at all (see the Wave/hiddenCount
// comment above), so this renders skeleton rows only. No `position: fixed`
// element lives inside this overlay — a backdrop-blur ancestor becomes the
// containing block for any fixed descendant, which is exactly what broke
// the MatchDeal pairing modal (see CLAUDE.md's note on that bug); the
// "Review" button here just scrolls, it never opens a modal.
function LockedWave({ hiddenCount, onReview }: { hiddenCount: number; onReview: () => void }) {
  return (
    <div className="relative">
      <div aria-hidden className="space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[56px] rounded-lg border border-gray-100 bg-gray-100" />
        ))}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/55 px-4 text-center backdrop-blur-sm">
        <span className="text-2xl">🔒</span>
        <p className="text-sm font-semibold text-gray-700">
          {hiddenCount} more startup{hiddenCount === 1 ? '' : 's'} unlock{hiddenCount === 1 ? 's' : ''} when you&apos;ve treated this wave
        </p>
        <button onClick={onReview} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0c637b]">
          Review the wave above
        </button>
      </div>
    </div>
  );
}

export function PipelinePanel({
  onOpenStartup, onGoToArchive, compareIds, setCompareIds, showComparison, setShowComparison, qaAccess,
}: {
  // Prompt 214 §B (remate) — conhecido a entrada, vindo do /api/portal/access.
  // Continua a ligar-se sozinho se uma accao voltar marcada `qa`, para o caso
  // de a flag faltar por alguma razao: os dois caminhos convergem no mesmo
  // estado, e o segundo e a rede do primeiro.
  qaAccess?: boolean;
  onOpenStartup: (orgId: string) => void;
  // Item 8 — the archive success toast's "Go to Archive" link.
  onGoToArchive: () => void;
  // Prompt 169 §B — lifted up to InvestorWorkspaceShell (was local state
  // here) so a selection made on this tab survives a trip to Evaluation
  // tools and back — that tab's own "Compare startups from your Pipeline →"
  // shortcut needs "the compareIds the investor already had marked, if
  // any" to mean something; local state here would already be gone by the
  // time the investor reaches that other tab (this component unmounts on
  // tab switch, same as every other tab's panel).
  compareIds: string[]; setCompareIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  showComparison: boolean; setShowComparison: (v: boolean) => void;
}) {
  // P134-A — which rows are expanded (chevron), independent of data —
  // toggling never fetches, per the mini-prompt's own acceptance criterion.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  function toggleExpanded(orgId: string) {
    setExpandedIds((ids) => {
      const next = new Set(ids);
      if (next.has(orgId)) next.delete(orgId); else next.add(orgId);
      return next;
    });
  }
  const [data, setData] = useState<PipelineResponse | null>(null);
  // AP-07/08 — confirming holds the card + action awaiting Cancel/Confirm;
  // reasonDraft is the free-text Pass reason (AP-08: required, not a fixed
  // category list). Cancel/close must change nothing — it only clears this
  // local state, no request is ever sent.
  const [confirming, setConfirming] = useState<{ orgId: string; action: 'pass' | 'interest' } | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  // P131-C — the server already short-circuits @ablute.pt QA sessions
  // (is_ablute_developer() in /api/portal/pipeline) so their clicks never
  // write a real signal, but it never told the person clicking that —
  // "I tested it and nothing happened" was the exact confusion this exists
  // to prevent. The server already returns { qa: true } for this case; this
  // just surfaces it instead of silently doing nothing differently.
  const [qaToast, setQaToast] = useState<string | null>(null);
  // Prompt 214 §B — uma sessao QA tem de ser inconfundivel DURANTE toda a
  // sessao, nao so depois do clique. Ontem houve 5 "express interest" na
  // ablute_ e ZERO chegaram ao founder: todas curto-circuitadas no gate QA,
  // e o unico sinal era um toast amarelo que desaparecia. O gate estava
  // certo; a comunicacao e que faltou.
  //
  // Fica true assim que UMA accao volte marcada como qa: a partir dai
  // sabe-se com certeza, sem inventar uma segunda deteccao de sessao.
  const [qaSession, setQaSession] = useState(!!qaAccess);
  // Item 8 — archiving worked (the entry landed in the Archive tab fine)
  // but gave zero feedback where the click happened: same card, same
  // buttons, nothing. The persistent "Archived" badge (isArchived, from the
  // server) fixes the state half of that; this is the one-time toast for
  // the moment it just happened.
  const [archivedToastOrgId, setArchivedToastOrgId] = useState<string | null>(null);
  // P133 (item 10) — which card's Interaction log drawer is open, if any.
  const [interactionLogOrgId, setInteractionLogOrgId] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const [remindedOrgId, setRemindedOrgId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'interested' | 'passed'>('all');
  // Prompt 121 §2.3 — sector/geography/stage filters, composed with the
  // existing status filter and the wave doseamento: filtering only decides
  // which cards render WITHIN an already-unlocked (or already-locked) wave,
  // it never changes wave.unlocked itself — see passesFilter below, which
  // stays the single gate the wave.items.filter(...) call already used.
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  // Prompt 127 Bloco B — the overview strip's one stat that isn't in
  // /api/portal/pipeline's own response (Tracking/Interested/Data room all
  // are). Meetings live in the Agenda's merged timeline instead (see
  // /api/portal/agenda), so this is a second, once-on-mount fetch rather
  // than pipeline reload traffic.
  const [meetingsCount, setMeetingsCount] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/portal/agenda').then((r) => r.json())
      .then((d) => setMeetingsCount((d.items ?? []).filter((i: { kind: string }) => i.kind === 'meeting').length))
      .catch(() => setMeetingsCount(null));
  }, []);
  // Prompt 164 B — this member's own weighted scorecard average per org
  // (same formula ScorecardPanel computes, aggregated server-side), so the
  // score stops living only on the isolated dossier page. Absent for any
  // org never scored — the badge simply doesn't render then.
  const [scorecardAvgs, setScorecardAvgs] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/portal/scorecard/summary').then((r) => r.json())
      .then((d) => setScorecardAvgs(d.averages ?? {}))
      .catch(() => setScorecardAvgs({}));
  }, []);

  // Prompt 169 §A — Berkus total for the comparison table. Deliberately
  // lazy (only once the comparator is actually shown, only for the up-to-3
  // orgIds being compared) — unlike scorecardAvgs above (one cheap summary
  // call covering every org at once), Berkus has no batch endpoint, so
  // firing it for every Pipeline card on every page load would be real,
  // unnecessary load for a table almost nobody opens.
  //
  // Prompt 174 — this used to also fetch TAM/SAM/SOM off the full dossier
  // route (/api/portal/startup/[orgId]) alongside Berkus; Prompt 169b had
  // already cancelled surfacing TAM/SAM/SOM anywhere (unreliable source,
  // Nuno's decision, repeated twice) before that landed. Reverted — Berkus
  // stays, the dossier fetch and its fields are gone.
  const [compareEnrichment, setCompareEnrichment] = useState<Record<string, { berkusTotal: number | null }>>({});
  useEffect(() => {
    if (!showComparison || compareIds.length === 0) return;
    const missing = compareIds.filter((id) => !(id in compareEnrichment));
    if (missing.length === 0) return;
    Promise.all(missing.map(async (orgId) => {
      const berkusRes = await fetch(`/api/portal/berkus?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).catch(() => ({ estimate: null }));
      const estimate = berkusRes.estimate as { sound_idea_eur: number; prototype_eur: number; team_eur: number; relationships_eur: number; sales_eur: number } | null;
      const berkusTotal = estimate
        ? estimate.sound_idea_eur + estimate.prototype_eur + estimate.team_eur + estimate.relationships_eur + estimate.sales_eur
        : null;
      return [orgId, { berkusTotal }] as const;
    })).then((entries) => {
      setCompareEnrichment((prev) => {
        const next = { ...prev };
        for (const [orgId, enrichment] of entries) next[orgId] = enrichment;
        return next;
      });
    });
  }, [showComparison, compareIds, compareEnrichment]);

  function toggleCompare(orgId: string) {
    setCompareIds((ids) => (ids.includes(orgId) ? ids.filter((id) => id !== orgId) : ids.length < MAX_COMPARE ? [...ids, orgId] : ids));
  }

  function load() {
    fetch('/api/portal/pipeline').then((r) => r.json()).then(setData);
  }
  useEffect(load, []);

  function startConfirm(orgId: string, action: 'pass' | 'interest') {
    setActionError(null);
    setReasonDraft('');
    setConfirming({ orgId, action });
  }
  function cancelConfirm() {
    // Deliberately a pure local reset — no fetch, nothing written.
    setConfirming(null);
    setReasonDraft('');
  }

  async function act(orgId: string, action: 'pass' | 'interest', reason?: string) {
    setBusyOrgId(orgId);
    setActionError(null);
    setQaToast(null);
    try {
      const res = await fetch('/api/portal/pipeline', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        // AP-14 — a teammate may have decided first; surface it plainly and
        // reload so this card reflects the actual (org-level) outcome.
        setActionError(body.error ?? 'Something went wrong — please try again.');
      } else {
        setConfirming(null);
        setReasonDraft('');
        if (body.qa) { setQaToast('QA session — action simulated, nothing recorded.'); setQaSession(true); }
      }
      load();
    } finally { setBusyOrgId(null); }
  }

  // Agenda (prompt 59) — "remind me in 2 weeks" straight from a Pipeline
  // card. No custom date picker for v1: two weeks is the one duration the
  // prompt names explicitly, and it's the common "circle back later" gap.
  async function remindIn2Weeks(orgId: string) {
    const remindAt = new Date(Date.now() + 14 * 86400000).toISOString();
    await fetch('/api/portal/agenda', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId, remindAt }),
    });
    setRemindedOrgId(orgId);
  }

  // Archive (prompt 60) — manual archive, distinct from a pass: the
  // investor sets it aside without recording a "why not" swipe reason.
  async function archiveManually(orgId: string) {
    setBusyOrgId(orgId);
    setArchivedToastOrgId(null);
    try {
      const res = await fetch('/api/portal/archive', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archiveOrgId: orgId }),
      });
      if (res.ok) setArchivedToastOrgId(orgId);
      load();
    } finally { setBusyOrgId(null); }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const waves = data.waves ?? [];
  const firstUnlocked = waves.find((w) => w.unlocked);

  if (waves.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">More startups joining — you&apos;ll be notified when a new match arrives.</p>
      </div>
    );
  }

  const allCards = waves.flatMap((w) => w.items);
  // Prompt 169 §A — the enrichment merge itself. scorecardAvgs already
  // covers every org (cheap summary call, not lazy); berkus comes from
  // compareEnrichment, only populated for orgIds actually being compared
  // (see that state's own comment above).
  const compareCards = compareIds.map((id) => allCards.find((c) => c.orgId === id)).filter((c): c is Card => !!c)
    .map((c) => ({
      ...c, scorecardAvg: scorecardAvgs[c.orgId] ?? null,
      berkusTotal: compareEnrichment[c.orgId]?.berkusTotal ?? null,
    }));
  // Prompt 121 §2.3 — option lists built from whatever's actually in the
  // Pipeline right now (not a fixed taxonomy import), so a filter sourced
  // from a canonical list could never show an option nothing actually
  // matches. This way every option is guaranteed live. (Prompt 176 §A fixed
  // the investor thesis picker's own taxonomy mismatch — this file was
  // never part of that bug, since it deliberately never imported a fixed
  // list to begin with; investor-sector-taxonomy.ts, the file this comment
  // used to point at, no longer exists.)
  const sectorOptions = [...new Set(allCards.flatMap((c) => c.sectors))].sort((a, b) => a.localeCompare(b));
  const countryOptions = [...new Set(allCards.map((c) => c.country).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const stageOptions = [...new Set(allCards.map((c) => c.stage).filter((v): v is string => !!v))];
  // AP-13 — "All" keeps Prompt 60's existing behaviour (passed cards live
  // in Archive, not duplicated here); "Passed" is the one filter that
  // deliberately surfaces them back in this view anyway.
  function passesFilter(c: Card) {
    if (statusFilter === 'all' ? c.status === 'passed' : c.status !== statusFilter) return false;
    if (sectorFilter !== 'all' && !c.sectors.includes(sectorFilter)) return false;
    if (countryFilter !== 'all' && c.country !== countryFilter) return false;
    if (stageFilter !== 'all' && c.stage !== stageFilter) return false;
    return true;
  }

  // Prompt 127 Bloco B — the "home" the investor workspace was missing: an
  // at-a-glance overview strip above the wave list, same idea as the
  // founder Dashboard's own funnel (OverviewPanel.tsx) — not a new number to
  // invent, client-side aggregation over data already loaded for this page
  // (allCards) plus the one Agenda-sourced count (meetings). Not a strict
  // funnel (these four aren't subsets of each other the way contacted →
  // replied → … is), so no "% of previous" column — just the Prompt 126-A
  // fix itself (a shared CSS grid column template, not flexbox, so the bar
  // column is the same pixel width on every row regardless of what else
  // that row shows) carried over to keep the same visual language.
  const overviewStats = [
    { label: 'Tracking', n: allCards.filter((c) => c.status === 'open').length },
    { label: 'Interested', n: allCards.filter((c) => c.status === 'interested').length },
    { label: 'Data room open', n: allCards.filter((c) => c.hasDataRoomAccess).length },
    { label: 'Meetings', n: meetingsCount ?? 0 },
  ];
  const overviewMax = Math.max(1, ...overviewStats.map((s) => s.n));
  // Visibilidade simétrica (07/08/2026) — a real account with zero real
  // startups published yet reads this block honestly (four 0s with a
  // near-invisible 4%-wide bar each) rather than looking like a broken
  // widget. Only reachable when waves.length > 0 already, so this is the
  // "activity hasn't started" case, not the zero-waves one (handled above).
  const overviewAllZero = overviewStats.every((s) => s.n === 0);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Pipeline</h1>
        <a href="/api/portal/export?type=pipeline" className="text-xs text-gray-400 hover:underline">Export CSV</a>
      </div>
      <div data-tour-id="investor-pipeline-overview" className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="grid items-center gap-x-2 gap-y-1.5 text-sm" style={{ gridTemplateColumns: '7rem 1fr 2.5rem' }}>
          {overviewStats.map((s) => (
            <Fragment key={s.label}>
              <span className="text-xs text-gray-500">{s.label}</span>
              <div className="h-4 rounded bg-[#0E7490]/80" style={{ width: `${Math.max(4, s.n / overviewMax * 100)}%` }} />
              <span className="text-right text-xs font-medium">{s.n}</span>
            </Fragment>
          ))}
        </div>
        {overviewAllZero && (
          <p className="mt-2 text-xs text-gray-400">No activity yet — this fills in as you and other investors review startups on the platform.</p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusFilter === f.value ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {/* Prompt 121 §2.3 — sector/geography/stage filters. Composed with the
          status filter and the wave doseamento above (passesFilter), never
          bypassing it: a locked wave stays locked no matter what these
          narrow it down to. */}
      <div data-tour-id="investor-pipeline-filters" className="flex flex-wrap items-center gap-1.5">
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
          <option value="all">All sectors</option>
          {sectorOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
          <option value="all">All geographies</option>
          {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600">
          <option value="all">All stages</option>
          {stageOptions.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>)}
        </select>
        {(sectorFilter !== 'all' || countryFilter !== 'all' || stageFilter !== 'all') && (
          <button onClick={() => { setSectorFilter('all'); setCountryFilter('all'); setStageFilter('all'); }}
            className="text-[11px] text-gray-400 hover:underline">
            Clear filters
          </button>
        )}
      </div>
      {data.usualCoInvestors && <p className="text-xs text-gray-400">Usually co-invests with: {data.usualCoInvestors}</p>}
      {actionError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{actionError}</p>}
      {/* Prompt 214 §B.1 — persistente, nao um toast: fica enquanto a sessao
          durar. O toast em baixo continua como reforco imediato (§B.3), mas
          deixou de ser o UNICO sinal. */}
      {qaSession && (
        <div className="sticky top-0 z-20 -mx-1 mb-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
          QA session — actions are simulated and nothing is recorded.
        </div>
      )}
      {qaToast && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{qaToast}</p>}

      {/* Prompt 127 §3 — before this, the only hint that comparison existed
          at all was the per-card checkbox itself, with zero invitation to
          use it; a visible entry point even at zero-selected fixes that.
          Once a card is ticked, this same slot becomes the existing
          "N selected / Compare" banner — one discovery surface, not two. */}
      {!showComparison && (compareIds.length > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-[#0E7490] bg-[#E8F4F8] px-3 py-2 text-xs">
          <span>{compareIds.length} selected to compare</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setCompareIds([])} className="text-gray-500 hover:underline">Clear</button>
            <button onClick={() => setShowComparison(true)} disabled={compareIds.length < 2}
              className="rounded-lg bg-[#0E7490] px-2.5 py-1 font-medium text-white disabled:opacity-40">
              Compare
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
          💡 Compare up to {MAX_COMPARE} startups side-by-side — tick the checkbox on any card below to get started.
        </div>
      ))}
      {showComparison && compareCards.length >= 2 && (
        <ComparisonView cards={compareCards} onClose={() => setShowComparison(false)} />
      )}

      {/* Prompt 189 — own vertical scroll capped at ~15 cards so the list
          doesn't grow the whole page; max-height (not a hard height) so a
          short pipeline still shrinks to fit rather than leaving dead
          white space below it, same reasoning as the founder-side table
          (Prompt 188 §1). Wave-unlock mechanism and LockedWave are
          untouched — they scroll normally as part of this same list. */}
      <div data-tour-id="investor-pipeline-list" className="space-y-4 overflow-y-auto" style={{ maxHeight: PIPELINE_CARD_LIST_MAX_HEIGHT_PX }}>
      {waves.map((wave) => (
        <div key={wave.index} id={`wave-${wave.index}`}>
          {waves.length > 1 && (
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Wave {wave.index + 1}{!wave.unlocked && ' — locked until the wave above is treated'}
            </p>
          )}
          {!wave.unlocked ? (
            <LockedWave
              hiddenCount={wave.hiddenCount ?? wave.items.length}
              onReview={() => document.getElementById(`wave-${wave.index - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          ) : (
          <div className="space-y-3">
            {/* Prompt 60 — a passed card moves to the Archive tab, not just
                grayed out here; still counted server-side toward this
                wave's unlock (see the API route), just not duplicated in
                both places. AP-13's "Passed" filter is the one exception
                that brings them back into view. */}
            {wave.items.filter(passesFilter).map((c) => {
              const expanded = expandedIds.has(c.orgId);
              return (
              <div key={c.orgId} className="rounded-lg border border-gray-200 bg-white">
                {/* P134-A — collapsed row: ~52-60px, triage information only.
                    Secondary actions and the fuller description only ever
                    appear once expanded (below) — the calculator has no
                    presence here at all anymore (it lives in Evaluation
                    tools + the dossier header, per the mini-prompt). */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <input type="checkbox" checked={compareIds.includes(c.orgId)} onChange={() => toggleCompare(c.orgId)}
                    disabled={!compareIds.includes(c.orgId) && compareIds.length >= MAX_COMPARE}
                    title="Select to compare" />
                  <button onClick={() => toggleExpanded(c.orgId)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <div className="min-w-0 flex-1">
                      {/* Prompt 183 §B — `truncate` on a bare inline <span>
                          doesn't reliably clip: an inline box has no width
                          of its own to overflow against, so a long oneLiner
                          just kept growing and drew over the shrink-0
                          Invited/score badges to the right (only visible on
                          cards with a short name + long oneLiner — every
                          other card's oneLiner was short enough to never
                          hit it). Wrapping name+oneLiner in their own
                          min-w-0 flex row, with oneLiner as a min-w-0
                          flex-1 block span, gives truncate an actual
                          shrinkable width to clip against while keeping
                          both on the same line as before. */}
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-sm font-semibold text-gray-900">
                          <Link href={`/portal/startup/${c.orgId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                            {c.name}
                          </Link>
                        </span>
                        {c.oneLiner && <span className="block min-w-0 flex-1 truncate text-xs text-gray-500">{c.oneLiner}</span>}
                        {(c.followOnSignals ?? []).map((s, i) => <FollowOnBadge key={i} signal={s} />)}
                      </div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      {c.status === 'passed' ? (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">Passed</span>
                      ) : c.status === 'interested' ? (
                        <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-medium text-[#0E7490]">
                          Interested{fmtDecidedAt(c.decidedAt, c.decidedByMe)}
                        </span>
                      ) : c.viaReferral ? (
                        <span className="rounded-full bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700"
                          title={`Referred${c.referredByName ? ` by ${c.referredByName}` : ''} through your network — never wave-gated.`}>
                          Referred{c.referredByName ? ` by ${c.referredByName}` : ''}
                        </span>
                      ) : c.viaGrant || c.viaDecision ? (
                        <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-medium text-[#0E7490]"
                          title="A real relationship already exists here — invited to the data room and/or already decided, never wave-gated.">
                          Invited
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500" title={`Wave ${wave.index + 1}`}>
                          W{wave.index + 1}
                        </span>
                      )}
                      <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-semibold text-[#0E7490]" title={c.matchReasons.join(', ')}>
                        {c.matchScore}%
                      </span>
                      {scorecardAvgs[c.orgId] != null && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700"
                          title="Your scorecard average — private to you, never shown to the startup.">
                          ★ {scorecardAvgs[c.orgId]}/10
                        </span>
                      )}
                    </div>
                    <div className="hidden shrink-0 whitespace-nowrap text-xs text-gray-400 md:block">
                      {c.stage && (STAGE_LABELS[c.stage] ?? c.stage)}
                      {fmtEur(c.roundTargetEur) && ` · ${fmtEur(c.roundTargetEur)}`}
                      {c.sectors.length > 0 && ` · ${c.sectors[0]}${c.sectors.length > 1 ? ` +${c.sectors.length - 1}` : ''}`}
                    </div>
                    {c.isArchived && <span className="hidden shrink-0 text-[11px] text-gray-400 lg:inline">📦</span>}
                    <span className="shrink-0 text-xs text-gray-400">{expanded ? '︿' : '⌄'}</span>
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-gray-100 px-3 py-3">
                    {/* Row content that only ever shows on the wave headers
                        above stays hidden on mobile in the collapsed row —
                        surface it here too so it's never lost, just moved. */}
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 sm:hidden">
                      {c.status === 'passed' ? (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">Passed</span>
                      ) : c.status === 'interested' ? (
                        <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-medium text-[#0E7490]">Interested{fmtDecidedAt(c.decidedAt, c.decidedByMe)}</span>
                      ) : c.viaReferral ? (
                        <span className="rounded-full bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700">Referred{c.referredByName ? ` by ${c.referredByName}` : ''}</span>
                      ) : c.viaGrant || c.viaDecision ? (
                        <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-medium text-[#0E7490]">Invited</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">W{wave.index + 1}</span>
                      )}
                      <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-semibold text-[#0E7490]">{c.matchScore}% match</span>
                      {scorecardAvgs[c.orgId] != null && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                          ★ {scorecardAvgs[c.orgId]}/10 your scorecard
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400">
                        {c.stage && (STAGE_LABELS[c.stage] ?? c.stage)}
                        {fmtEur(c.roundTargetEur) && ` · ${fmtEur(c.roundTargetEur)}`}
                        {c.sectors.length > 0 && ` · ${c.sectors.join(', ')}`}
                      </span>
                    </div>

                    {c.description && <p className="text-xs text-gray-600">{c.description}</p>}
                    {/* Prompt 325 — Discovery-visible, additional to
                        description/oneLiner above; absent when the founder
                        hasn't filled it in. */}
                    {(c.introProblem || c.introSolution) && (
                      <div className="mt-1 space-y-0.5">
                        {c.introProblem && <p className="text-xs text-gray-600"><span className="font-medium text-gray-500">Problem: </span>{c.introProblem}</p>}
                        {c.introSolution && <p className="text-xs text-gray-600"><span className="font-medium text-gray-500">Solution: </span>{c.introSolution}</p>}
                      </div>
                    )}
                    {c.trackingCount > 0 && (
                      <p className="mt-1.5 text-xs text-gray-400">
                        {c.trackingCount} other investor{c.trackingCount === 1 ? ' is' : 's are'} tracking {c.stage ? (STAGE_LABELS[c.stage] ?? c.stage) : 'this stage'} rounds
                      </p>
                    )}

                    {/* Item 8 — archiving used to be invisible on the card
                        that triggered it: same buttons, same look, no sign
                        anything happened. isArchived is real, reload-proof
                        server state (Archive tab's own source of truth) —
                        kept separate from interested/passed/open above,
                        since archiving tidies up, it never erases the
                        underlying decision (AP-06). */}
                    {c.isArchived && <p className="mt-2 text-[11px] font-medium text-gray-400">📦 Archived</p>}
                    {archivedToastOrgId === c.orgId && (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
                        <span>Archived — you&apos;ll find it in the Archive tab.</span>
                        <button onClick={onGoToArchive} className="font-medium text-[#0E7490] hover:underline">Go to Archive →</button>
                      </div>
                    )}

                    {c.status === 'passed' ? (
                      <p className="mt-2 text-xs text-gray-400">
                        Passed{fmtDecidedAt(c.decidedAt, c.decidedByMe)}{c.passReason && ` — ${c.passReason}`}
                      </p>
                    ) : c.status === 'interested' ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {c.hasDataRoomAccess && (
                          <button onClick={() => onOpenStartup(c.orgId)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
                            Open data room
                          </button>
                        )}
                        <button onClick={() => setInteractionLogOrgId(c.orgId)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
                          🗂 Interaction log
                        </button>
                        <button onClick={() => archiveManually(c.orgId)} disabled={busyOrgId === c.orgId}
                          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                          Archive{qaSession ? ' (QA)' : ''}
                        </button>
                      </div>
                    ) : wave.unlocked && confirming?.orgId === c.orgId ? (
                      // AP-07/08 — a confirmation step before either decision
                      // is recorded; Pass requires a free-text reason (max
                      // 1000 chars). Cancel only clears local state.
                      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        {confirming.action === 'interest' ? (
                          <p className="text-xs text-gray-700">Confirm you&apos;re interested in {c.name}? The founder will be notified.</p>
                        ) : (
                          <>
                            {/* Prompt 214 §A.2 — a caixa de razao ja existia;
                                o que faltava era o titulo dizer o que isto e.
                                Uma decisao final merece ser anunciada antes
                                de ser explicada. */}
                            <p className="mb-1 text-sm font-bold text-[#B00000]">Pass on {c.name} — this is final</p>
                            <label className="mb-1 block text-xs font-medium text-gray-700">Reason for passing (required)</label>
                            <textarea value={reasonDraft} onChange={(e) => setReasonDraft(e.target.value.slice(0, REASON_MAX_LEN))}
                              rows={3} placeholder="Why isn't this a fit right now?"
                              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
                            <p className="mt-0.5 text-[11px] font-medium text-[#B00000]">
                              The data room will be revoked and this can&apos;t be undone.
                            </p>
                            <p className="text-[10px] text-gray-400">{reasonDraft.length}/{REASON_MAX_LEN}</p>
                          </>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={cancelConfirm} disabled={busyOrgId === c.orgId}
                            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-white disabled:opacity-40">
                            Cancel
                          </button>
                          <button
                            onClick={() => act(c.orgId, confirming.action, confirming.action === 'pass' ? reasonDraft : undefined)}
                            disabled={busyOrgId === c.orgId || (confirming.action === 'pass' && reasonDraft.trim().length === 0)}
                            className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                            {busyOrgId === c.orgId ? 'Saving…' : confirming.action === 'interest' ? 'Confirm interest' : 'Confirm pass'}
                          </button>
                        </div>
                      </div>
                    ) : wave.unlocked ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {/* P120 Block A — a card without a grant is eligible
                            by published profile alone; the data room stays
                            gated on the founder actually consenting
                            (access_grants). That trust boundary doesn't
                            move — only discovery does. */}
                        {c.hasDataRoomAccess ? (
                          <button onClick={() => onOpenStartup(c.orgId)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
                            Open data room
                          </button>
                        ) : (
                          <span className="rounded-lg border border-dashed border-gray-200 px-2.5 py-1.5 text-xs text-gray-400">
                            🔒 Access to documents is granted by the founder — express interest to start the conversation.
                          </span>
                        )}
                        <button onClick={() => startConfirm(c.orgId, 'interest')} disabled={busyOrgId === c.orgId}
                          className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                          Express interest{qaSession ? ' (QA)' : ''}
                        </button>
                        {remindedOrgId === c.orgId ? (
                          <span className="text-xs text-gray-400">Reminder set for 2 weeks</span>
                        ) : (
                          <button onClick={() => remindIn2Weeks(c.orgId)} className="text-xs text-gray-400 hover:underline">
                            Remind me in 2 weeks
                          </button>
                        )}
                        {/* Prompt 214 §A.1 — Pass e uma accao FINAL que revoga
                            o data room. Era texto cinzento solto ao lado do
                            botao de interesse; passa a botao com moldura, na
                            mesma hierarquia da linha. O peso visual tem de
                            corresponder ao peso da consequencia. */}
                        <button onClick={() => startConfirm(c.orgId, 'pass')}
                          className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-[#B00000] hover:border-[#B00000] hover:bg-red-50">
                          Pass{qaSession ? ' (QA)' : ''}
                        </button>
                        <button onClick={() => setInteractionLogOrgId(c.orgId)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
                          🗂 Interaction log
                        </button>
                        <button onClick={() => archiveManually(c.orgId)} disabled={busyOrgId === c.orgId}
                          className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                          Archive{qaSession ? ' (QA)' : ''}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setInteractionLogOrgId(c.orgId)} className="mt-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
                        🗂 Interaction log
                      </button>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
          )}
        </div>
      ))}
      </div>
      {!firstUnlocked && <p className="text-xs text-gray-400">All caught up — check back as new matches arrive.</p>}
      {interactionLogOrgId && (
        <InteractionLogDrawer orgId={interactionLogOrgId}
          orgName={allCards.find((c) => c.orgId === interactionLogOrgId)?.name ?? 'Startup'}
          onClose={() => setInteractionLogOrgId(null)} />
      )}
    </div>
  );
}
