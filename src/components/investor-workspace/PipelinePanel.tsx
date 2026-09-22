'use client';
// Investor Workspace Pipeline (prompt 58) — startups presented in waves by
// match score. Mirrors the founder-side pipeline's doseamento principle:
// only the current wave is actionable, the rest stay locked until it's
// fully treated (every card passed or expressed interest on).
//
// Prompt 681 — one taxonomy (New/Evaluating/Interested/Due diligence ‖
// Passed/Archived, investor-pipeline-stage.ts), six funnel cards, group
// bands instead of wave headers, a sliding dossier panel that pushes the
// list, and drag-to-card. The wave mechanism itself (doseamento, monthly
// admission cap, LockedWave) is UNCHANGED — waves decide what is unlocked
// and visible at all; the taxonomy decides where an unlocked card sits.
import { Fragment, Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { InteractionLogDrawer } from './InteractionLogDrawer';
import { ArchivePanel } from './ArchivePanel';
import { WatchingPanel } from './WatchingPanel';
import { LockedWave } from './LockedWave';
import { InvestorPipelineFunnel } from './InvestorPipelineFunnel';
import { useInvestorPipelineRowDrag, useReducedMotion, type DraggableCard } from './useInvestorPipelineRowDrag';
import { FollowOnBadge } from '../FollowOnBadge';
import type { FollowOnPayload } from '@/lib/network';
import { waveCardBadge, waveGroupLabel, type PipelineWaveKind } from '@/lib/pipeline-waves';
import { pipelineQuotaLine, type PipelineQuota } from '@/lib/pipeline-quota-line';
import { INVESTOR_PIPELINE_CARDS, investorPipelineCounts, type InvestorPipelineCardKey } from '@/lib/investor-pipeline-taxonomy';
import { INVESTOR_PIPELINE_STAGE_LABEL, type InvestorPipelineStage } from '@/lib/investor-pipeline-stage';
import { investorDropTargetAccepts, NON_DROP_TARGET_MESSAGE, UNDO_WINDOW_MS, type InvestorDropTarget } from '@/lib/investor-pipeline-drop';
import { EntityAvatar } from '@/components/EntityAvatar';
import { fitBucketFromScore } from '@/lib/catalog-fit-bucket';
import { fitLabel, fitStyle } from '@/components/ui';
import { useConfirmWithFields } from '@/lib/confirm';
import { fetchPipelineShared } from '@/lib/portal-pipeline-client';
import { StartupDossierPageInner } from '@/components/portal/StartupDossierContent';
import { LoadingState } from '@/components/workspace-shell/LoadingState';
import { PASS_REASON_CHIPS, TOO_EARLY_SUBREASONS } from '@/lib/investor-signal-events';

interface Card extends DraggableCard {
  orgId: string; name: string; oneLiner: string | null;
  description: string | null;
  introProblem?: string; introSolution?: string;
  sectors: string[]; stage: string | null;
  hqCity: string | null; country: string | null; roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: 'pre_money' | 'post_money' | null; roundInstruments: string[];
  matchScore: number; matchReasons: string[]; status: 'open' | 'passed' | 'interested'; passReason: string | null;
  decidedAt?: string | null; decidedByMe?: boolean | null;
  viaGrant?: boolean; viaDecision?: boolean;
  viaReferral?: boolean; referredByName?: string | null;
  // Prompt 683 — a real portfolio company (the founder already recorded
  // this investor's firm as `invested` in their own pipeline). Badge only —
  // pipelineStage is derived the same way as any other card.
  viaPortfolio?: boolean;
  followOnSignals?: FollowOnPayload[];
  isArchived?: boolean;
  trackingCount: number; hasDataRoomAccess: boolean;
  canWithdrawInterest?: boolean;
  hasConversation?: boolean;
  // Prompt 681 §1/§2.4 additions — see investor-pipeline.ts for how each is derived.
  pipelineStage: InvestorPipelineStage;
  pipelineStageDetail: string | null;
  nextAction: { label: string; at: string | null; overdue: boolean } | null;
  lastActivityAt: string | null;
  archivedAt: string | null;
  hype: boolean;
  isWatching: boolean;
  roundTargetCloseDate: string | null;
  website: string | null;
  hasGrantedLevel2: boolean;
  hasGrantedLevel3: boolean;
  hasPendingLevel3Request: boolean;
}
interface UnavailableCard { orgId: string; name: string; status: 'open' | 'passed' | 'interested'; decidedAt?: string | null; unavailable: true }
type AnyCard = Card | UnavailableCard;
function isUnavailable(c: AnyCard): c is UnavailableCard {
  return (c as UnavailableCard).unavailable === true;
}

interface Wave {
  index: number;
  kind?: PipelineWaveKind;
  discoveryIndex?: number | null;
  items: AnyCard[];
  unlocked: boolean;
  hiddenCount?: number;
}
interface PipelineResponse { linked: boolean; waves?: Wave[]; usualCoInvestors?: string | null; quota?: PipelineQuota | null }

const REASON_MAX_LEN = 1000;
const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };
type SecondaryFilterValue = 'watching';

function fmtEur(n: number | null) {
  return n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
function fmtDateShort(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function fmtDecidedAt(iso: string | null | undefined, decidedByMe: boolean | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const who = decidedByMe == null ? '' : decidedByMe ? ' by you' : ' by a colleague at your firm';
  return ` on ${date}${who}`;
}
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function UnavailableRow({ card }: { card: UnavailableCard }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <div className="px-3 py-2.5">
        <div className="text-sm font-semibold text-gray-400">{card.name}</div>
        <div className="mt-0.5 text-xs text-gray-400">This startup is no longer available</div>
      </div>
    </div>
  );
}

// Prompt 681 §2.4 point 3 — the Fit pill, reusing fitBucketFromScore (the
// existing 75/55/35 thresholds) and FitTag's own style classes, but keeping
// THIS row's own tooltip (matchReasons — "the criteria already computed"),
// not FitTag's generic fixed copy.
function FitPill({ score, reasons }: { score: number; reasons: string[] }) {
  const bucket = fitBucketFromScore(score);
  return (
    <span className={`text-xs ${fitStyle[bucket]}`} title={reasons.join(', ')}>
      Fit: {fitLabel[bucket]}
    </span>
  );
}

const STAGE_PILL_STYLE: Record<InvestorPipelineStage, { bg: string; fg: string }> = {
  new: { bg: '#eef3f6', fg: '#5d7280' },
  evaluating: { bg: '#e9f2fd', fg: '#1d6fd4' },
  interested: { bg: '#e6f5fa', fg: '#0e7490' },
  due_diligence: { bg: '#fdf3e6', fg: '#b4670c' },
  passed: { bg: '#f3f4f6', fg: '#5d7280' },
  archived: { bg: '#e6f6ed', fg: '#158049' },
};

// Prompt 681 §2.4 point 5 / Prompt 686 A.4 — the stage pill, shared between
// the right-hand column (wide layout) and the collapsed row's own space
// (panel-open layout, where the one-liner is what makes room for it).
function StagePill({ card }: { card: Card }) {
  const s = STAGE_PILL_STYLE[card.pipelineStage];
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: s.bg, color: s.fg }}>
      {INVESTOR_PIPELINE_STAGE_LABEL[card.pipelineStage]}{card.pipelineStageDetail ? ` · ${card.pipelineStageDetail}` : ''}
    </span>
  );
}

export function PipelinePanel({ onOpenStartup }: {
  // Prompt 681 §3 — the OLD "open a startup" mechanism (a full tab swap to
  // a different, older snapshot component owned by PortalPage). Superseded
  // for viewing a startup FROM the Pipeline list by this file's own sliding
  // panel (embedding the real dossier, StartupDossierPageInner) — kept only
  // as a prop so PortalPage's existing wiring doesn't need touching, but
  // nothing in this component calls it anymore.
  onOpenStartup: (orgId: string) => void;
}) {
  return (
    <Suspense fallback={<LoadingState text="Loading your pipeline…" />}>
      <PipelinePanelInner onOpenStartup={onOpenStartup} />
    </Suspense>
  );
}

function PipelinePanelInner({ onOpenStartup: _onOpenStartup }: { onOpenStartup: (orgId: string) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirmWithFields = useConfirmWithFields();
  const reducedMotion = useReducedMotion();

  // Prompt 681 §3 — this Pipeline's own address for "which startup's panel
  // is open", independent of the outer shell's ?tab=/?orgId= (the OLD
  // startupCard mechanism). Shareable and reload-proof on its own.
  const openOrgId = searchParams.get('startup');
  const setOpenOrgId = useCallback((orgId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (orgId) params.set('startup', orgId); else params.delete('startup');
    router.replace(params.toString() ? `${pathname}?${params}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  function toggleExpanded(orgId: string) {
    setExpandedIds((ids) => {
      const next = new Set(ids);
      if (next.has(orgId)) next.delete(orgId); else next.add(orgId);
      return next;
    });
  }
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [confirming, setConfirming] = useState<{ orgId: string; action: 'pass' | 'interest' } | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  // Prompt 715 Pedido B — private, optional, multi-select chips on a pass.
  const [chipsDraft, setChipsDraft] = useState<string[]>([]);
  const [chipSubreasonDraft, setChipSubreasonDraft] = useState<string | null>(null);
  const [chipsRegisteredToast, setChipsRegisteredToast] = useState(false);
  useEffect(() => {
    if (!chipsRegisteredToast) return;
    const t = window.setTimeout(() => setChipsRegisteredToast(false), 2500);
    return () => window.clearTimeout(t);
  }, [chipsRegisteredToast]);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  function setCardError(orgId: string, message: string | null) {
    setActionErrors((prev) => {
      if (message === null) {
        if (!(orgId in prev)) return prev;
        const next = { ...prev }; delete next[orgId]; return next;
      }
      return { ...prev, [orgId]: message };
    });
  }
  const [archivedToastOrgId, setArchivedToastOrgId] = useState<string | null>(null);
  const [interactionLogOrgId, setInteractionLogOrgId] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const [menuOpenOrgId, setMenuOpenOrgId] = useState<string | null>(null);
  // Prompt 686 A.3 — same pattern as the founder pipeline page (672):
  // filters collapse behind an icon while the panel is open (the list only
  // has ~320px left), collapsed by default each time the panel opens.
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  useEffect(() => { setFiltersExpanded(false); }, [openOrgId]);
  const [followupsByOrg, setFollowupsByOrg] = useState<Record<string, { id: string; date: string }>>({});
  const [confirmingWithdrawOrgId, setConfirmingWithdrawOrgId] = useState<string | null>(null);
  // Prompt 681 §2.1 — the six groups replace the old decision filter;
  // 'watching' stays a secondary filter (its own tab-like content, same as
  // before) since it isn't one of the six taxonomy stages.
  const [secondaryFilter, setSecondaryFilter] = useState<SecondaryFilterValue | null>(null);
  const [cardFilter, setCardFilter] = useState<InvestorPipelineCardKey | null>(null);
  // Prompt 681 §2.1 — Passed/Archived open collapsed by default (replaces
  // the old AP-13 "All hides Passed" exception — see this file's own
  // DECISIONS.md entry).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<InvestorPipelineCardKey>>(new Set(['passed', 'archived']));
  function toggleGroup(key: InvestorPipelineCardKey) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const [archivedCount, setArchivedCount] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/portal/archive').then((r) => r.json()).then((d) => setArchivedCount((d.entries ?? []).length)).catch(() => setArchivedCount(null));
  }, []);
  const [watchingCount, setWatchingCount] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/portal/watchlist').then((r) => r.json()).then((d) => setWatchingCount((d.items ?? []).length)).catch(() => setWatchingCount(null));
  }, []);
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'fit' | 'last_activity' | 'round_close'>('fit');
  function loadAgenda() {
    fetch('/api/portal/agenda').then((r) => r.json()).then((d) => {
      const items = (d.items ?? []) as { kind: string; orgId?: string; followupId?: string; date: string }[];
      const followups: Record<string, { id: string; date: string }> = {};
      for (const i of items) if (i.kind === 'follow_up' && i.orgId && i.followupId) followups[i.orgId] = { id: i.followupId, date: i.date };
      setFollowupsByOrg(followups);
    }).catch(() => { setFollowupsByOrg({}); });
  }
  useEffect(loadAgenda, []);
  const [scorecardAvgs, setScorecardAvgs] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/portal/scorecard/summary').then((r) => r.json())
      .then((d) => setScorecardAvgs(d.averages ?? {}))
      .catch(() => setScorecardAvgs({}));
  }, []);

  // Prompt 687 §3 — the initial mount-time load (no force) is the one that
  // gets deduped against useInvestorActions' own simultaneous mount-time
  // fetch (InvestorWorkspaceShell.tsx) when opening straight into
  // /portal?tab=pipeline. Every OTHER call below is a refresh AFTER an
  // action (Express interest, Pass, Archive, a reminder, a level request…)
  // and forces a real request — reusing a cached response there would hide
  // the investor's own change from the screen they're looking at.
  function load(force = false) {
    fetchPipelineShared<PipelineResponse>({ force }).then(setData);
  }
  useEffect(() => load(), []);

  function startConfirm(orgId: string, action: 'pass' | 'interest') {
    setCardError(orgId, null);
    setReasonDraft('');
    setChipsDraft([]);
    setChipSubreasonDraft(null);
    setConfirming({ orgId, action });
    setMenuOpenOrgId(null);
  }
  function cancelConfirm() {
    setConfirming(null);
    setReasonDraft('');
    setChipsDraft([]);
    setChipSubreasonDraft(null);
  }

  // Prompt 715 Pedido B — chips are private (never sent to the founder,
  // never shown in any founder-facing view), optional, multi-select. The
  // toast on success is deliberately quiet ("Registered") — no promise
  // about future effect, since fase 0-1 never reorders or learns from them.
  async function act(orgId: string, action: 'pass' | 'interest', reason?: string, chips?: string[], chipSubreason?: string) {
    setBusyOrgId(orgId);
    setCardError(orgId, null);
    try {
      const res = await fetch('/api/portal/pipeline', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, action, reason, chips, chipSubreason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setCardError(orgId, body.error ?? 'Something went wrong — please try again.');
      } else {
        setConfirming(null);
        setReasonDraft('');
        setChipsDraft([]);
        setChipSubreasonDraft(null);
        if (chips && chips.length > 0) setChipsRegisteredToast(true);
      }
      load(true);
    } finally { setBusyOrgId(null); }
  }

  async function remindIn2Weeks(orgId: string) {
    const remindAt = new Date(Date.now() + 14 * 86400000).toISOString();
    await fetch('/api/portal/agenda', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId, remindAt }),
    });
    loadAgenda(); load(true);
  }
  async function cancelReminder(followupId: string) {
    await fetch(`/api/portal/agenda?id=${encodeURIComponent(followupId)}`, { method: 'DELETE' });
    loadAgenda(); load(true);
  }

  // Prompt 681 §4 — archiveManually now optionally reports the archive
  // entry's own id (added to the route/createArchiveEntry return this same
  // prompt), so a drag-to-Archived drop can offer an immediate Undo without
  // a second round-trip. The plain menu/button path ignores it, unchanged.
  async function archiveManually(orgId: string): Promise<string | null> {
    setBusyOrgId(orgId);
    setArchivedToastOrgId(null);
    setCardError(orgId, null);
    try {
      const res = await fetch('/api/portal/archive', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archiveOrgId: orgId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setCardError(orgId, body.error ?? 'Could not archive — please try again.'); return null; }
      setArchivedToastOrgId(orgId);
      load(true);
      return (body.entryId as string | undefined) ?? null;
    } finally { setBusyOrgId(null); }
  }
  async function reopenArchiveEntry(entryId: string) {
    await fetch('/api/portal/archive', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId }),
    });
    load(true);
  }

  async function withdrawInterest(orgId: string) {
    setBusyOrgId(orgId);
    setCardError(orgId, null);
    try {
      const res = await fetch('/api/portal/pipeline/withdraw-interest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) setCardError(orgId, body.error ?? 'Could not withdraw — please try again.');
      else setConfirmingWithdrawOrgId(null);
      load(true);
    } finally { setBusyOrgId(null); }
  }

  // Prompt 681 §2.4 point 8 — "Request full profile"/"Request contact",
  // reusing the exact same endpoint the dossier page's own ladder controls
  // call. New call SITE, not a new capability.
  async function requestLevel(orgId: string, level: 2 | 3) {
    setBusyOrgId(orgId);
    setCardError(orgId, null);
    setMenuOpenOrgId(null);
    try {
      const res = await fetch('/api/portal/interest-level', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, level }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) setCardError(orgId, body.error ?? 'Could not send that request — please try again.');
      load(true);
    } finally { setBusyOrgId(null); }
  }

  // Prompt 681 §4 — the drag-to-card gesture. A confirmed drop always calls
  // the SAME action function as the equivalent button/menu item — the drag
  // is an alternate path to it, never a new one. Interested/Passed use the
  // app's shared confirm-with-fields dialog (a real popup, appropriate for
  // a drop that lands on a header card far from any one row's own inline
  // confirm box); Archived applies immediately with an Undo toast, same as
  // clicking "Archive" today.
  const [dropUndo, setDropUndo] = useState<{ orgId: string; name: string; entryId: string | null; kind: InvestorDropTarget } | null>(null);
  useEffect(() => {
    if (!dropUndo) return;
    const t = window.setTimeout(() => setDropUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [dropUndo]);

  const drag = useInvestorPipelineRowDrag<Card>({
    enabled: !openOrgId && !secondaryFilter,
    reducedMotion,
    onDrop: async (card, target) => {
      if (!investorDropTargetAccepts(target)) return false; // door already told the story; nothing to commit.
      if (target === 'interested') {
        const values = await confirmWithFields({
          title: `Express interest in ${card.name}?`, message: 'The founder will be notified.', confirmLabel: 'Confirm interest',
        });
        if (!values) return false;
        await act(card.orgId, 'interest');
        return true;
      }
      if (target === 'passed') {
        const values = await confirmWithFields({
          title: `Pass on ${card.name}? This is final.`,
          message: 'The data room will be revoked and this can’t be undone.',
          confirmLabel: 'Confirm pass', destructive: true,
          fields: [{ key: 'reason', label: 'Reason for passing (required)', type: 'text', placeholder: "Why isn't this a fit right now?" }],
        });
        if (!values || !values.reason?.trim()) return false;
        await act(card.orgId, 'pass', values.reason.trim());
        return true;
      }
      // archived — no confirmation (matches the existing Archive button),
      // immediate apply + 8s Undo.
      const entryId = await archiveManually(card.orgId);
      setDropUndo({ orgId: card.orgId, name: card.name, entryId, kind: 'archived' });
      return true;
    },
  });

  if (!data) return <LoadingState text="Loading your pipeline…" />;
  const waves = data.waves ?? [];
  const quotaLine = pipelineQuotaLine(data.quota, new Date().toISOString());

  if (waves.length === 0 && !secondaryFilter) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">More startups joining — you&apos;ll be notified when a new match arrives.</p>
        {archivedCount != null && archivedCount > 0 && (
          <button onClick={() => setCollapsedGroups((s) => { const n = new Set(s); n.delete('archived'); return n; })} className="mt-2 text-xs text-[#0E7490] hover:underline">
            View Archived ({archivedCount}) →
          </button>
        )}
      </div>
    );
  }

  const unlockedWaves = waves.filter((w) => w.unlocked);
  const lockedWave = waves.find((w) => !w.unlocked) ?? null;
  const allAnyCards = unlockedWaves.flatMap((w) => w.items);
  const allCards = allAnyCards.filter((c): c is Card => !isUnavailable(c));
  const sectorOptions = [...new Set(allCards.flatMap((c) => c.sectors))].sort((a, b) => a.localeCompare(b));
  const countryOptions = [...new Set(allCards.map((c) => c.country).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const stageOptions = [...new Set(allCards.map((c) => c.stage).filter((v): v is string => !!v))];

  function passesFilter(c: AnyCard) {
    if (sectorFilter !== 'all' && (isUnavailable(c) || !c.sectors.includes(sectorFilter))) return false;
    if (countryFilter !== 'all' && (isUnavailable(c) || c.country !== countryFilter)) return false;
    if (stageFilter !== 'all' && (isUnavailable(c) || c.stage !== stageFilter)) return false;
    return true;
  }

  // Prompt 681 §1.2/§2.1 — the six groups, from the SAME pipelineStage every
  // card already carries (server-derived, investor-pipeline-stage.ts).
  // Order within each group is preserved from allCards' own match-score
  // sort unless a different sort is picked — never re-derived independently
  // of the card list, so a group's count and its rows can never drift.
  const filteredCards = allAnyCards.filter(passesFilter);
  const stageOf = (c: AnyCard): InvestorPipelineStage | null => (isUnavailable(c) ? null : c.pipelineStage);
  const counts = investorPipelineCounts(allCards.filter(passesFilter).map((c) => c.pipelineStage));
  const total = INVESTOR_PIPELINE_CARDS.reduce((s, card) => s + counts[card.key], 0);

  function sortGroup(cards: AnyCard[]): AnyCard[] {
    if (sortBy === 'fit') return cards; // already match-score-descending from the server.
    const real = cards.filter((c): c is Card => !isUnavailable(c));
    const unavailable = cards.filter((c) => isUnavailable(c));
    if (sortBy === 'last_activity') {
      real.sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
    } else {
      real.sort((a, b) => {
        if (!a.roundTargetCloseDate && !b.roundTargetCloseDate) return 0;
        if (!a.roundTargetCloseDate) return 1;
        if (!b.roundTargetCloseDate) return -1;
        return a.roundTargetCloseDate.localeCompare(b.roundTargetCloseDate);
      });
    }
    return [...real, ...unavailable];
  }

  const dossierOrgName = allAnyCards.find((c) => c.orgId === openOrgId)?.name ?? null;
  const filtersActive = sectorFilter !== 'all' || countryFilter !== 'all' || stageFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* Prompt 686 A.2 — header, quota line, total, and the six funnel
          cards stay full-width ABOVE the list/panel split, always. With
          the panel open the split only starts below this block — six cards
          in one row need more than the ~320px the list column gets, and
          breaking them into two rows here used to overlap the header. */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Pipeline</h1>
        <a href="/api/portal/export?type=pipeline" className="text-xs text-gray-400 hover:underline">Export CSV</a>
      </div>
      {quotaLine && <p className="-mt-2 text-xs text-gray-500">{quotaLine}</p>}
      <p className="-mt-2 text-xs text-gray-500">{total} startup{total === 1 ? '' : 's'} in your pipeline</p>

      <InvestorPipelineFunnel
        counts={counts}
        activeFilter={cardFilter}
        onFilter={(k) => { setCardFilter(k); setSecondaryFilter(null); }}
        dragActive={drag.active}
        dragOver={drag.over}
      />

      {/* Prompt 686 A.1 — the list shrinks to ~320px (270-340px, matching
          the founder pipeline page's own grid exactly) and the panel takes
          the rest — this was inverted before (list got 1fr, panel was
          capped narrow), squeezing the dossier into the smaller column. */}
      <div className={openOrgId ? 'grid grid-cols-1 items-start gap-3 min-[900px]:grid-cols-[minmax(270px,340px)_1fr]' : ''}>
      <div className={openOrgId ? 'min-w-0 max-[899px]:hidden' : 'min-w-0 space-y-4'}>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setSecondaryFilter(secondaryFilter === 'watching' ? null : 'watching')}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${secondaryFilter === 'watching' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            👁 Watching{watchingCount != null ? ` (${watchingCount})` : ''}
          </button>
          {/* Prompt 686 A.3 — same pattern as the founder pipeline page
              (Prompt 672): with the panel open the list is too narrow for
              four controls beside each other, so they collapse behind this
              icon (a dot when one is actually active) and reopen inline on
              click. Collapsed again every time the panel opens (the effect
              near the top of this component resets filtersExpanded). */}
          {openOrgId && !filtersExpanded && (
            <button onClick={() => setFiltersExpanded(true)} title="Filters"
              className="relative rounded-lg border border-gray-300 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50">
              ⚙ Filters
              {filtersActive && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#0E7490]" />}
            </button>
          )}
        </div>

        {secondaryFilter === 'watching' ? (
          <WatchingPanel onOpenStartup={(orgId) => setOpenOrgId(orgId)} />
        ) : (
        <>
        {(!openOrgId || filtersExpanded) && (
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
          {filtersActive && (
            <button onClick={() => { setSectorFilter('all'); setCountryFilter('all'); setStageFilter('all'); }}
              className="text-[11px] text-gray-400 hover:underline">
              Clear filters
            </button>
          )}
          <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
            Sort:
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600">
              <option value="fit">Fit</option>
              <option value="last_activity">Last activity</option>
              <option value="round_close">Round close</option>
            </select>
          </span>
          {openOrgId && (
            <button onClick={() => setFiltersExpanded(false)} className="text-[11px] text-gray-400 hover:underline">Hide filters</button>
          )}
        </div>
        )}
        {data.usualCoInvestors && <p className="text-xs text-gray-400">Usually co-invests with: {data.usualCoInvestors}</p>}

        <div data-tour-id="investor-pipeline-overview" className="space-y-3">
          {INVESTOR_PIPELINE_CARDS.map((groupCard) => {
            const groupKey = groupCard.key;
            const groupRows = sortGroup(filteredCards.filter((c) => stageOf(c) === groupKey));
            // Prompt 681 §2.1 — empty groups hide, unless the funnel is
            // explicitly filtered down to exactly this (now-empty) group —
            // same exception the founder side's own group bands use, so
            // narrowing to a group never just vanishes with no explanation.
            if (groupRows.length === 0 && cardFilter !== groupKey) return null;
            if (cardFilter && cardFilter !== groupKey) return null;
            const collapsed = collapsedGroups.has(groupKey);
            return (
              <div key={groupKey} className="rounded-lg border border-gray-100">
                <button onClick={() => toggleGroup(groupKey)}
                  className="flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left"
                  style={{ background: collapsed ? undefined : undefined }}>
                  <span className="text-sm">{{ new: '👋', evaluating: '🔍', interested: '🖐', due_diligence: '📄', passed: '✕', archived: '📦' }[groupKey]}</span>
                  <span className="text-sm font-semibold text-gray-800">{groupCard.label}</span>
                  <span className="text-xs text-gray-400">{groupRows.length} startup{groupRows.length === 1 ? '' : 's'}</span>
                  {!openOrgId && <span className="ml-auto text-xs text-gray-400">{groupCard.context}</span>}
                  <span className="text-xs text-gray-400">{collapsed ? '▸' : '▾'}</span>
                </button>
                {!collapsed && (
                  <div className="space-y-2 border-t border-gray-100 p-2">
                    {groupRows.map((c) => {
                      if (isUnavailable(c)) return <UnavailableRow key={c.orgId} card={c} />;
                      return (
                        <PipelineRow
                          key={c.orgId} card={c} expanded={expandedIds.has(c.orgId)} openOrgId={openOrgId}
                          onOpen={() => setOpenOrgId(c.orgId)}
                          onToggleExpand={() => toggleExpanded(c.orgId)}
                          scorecardAvg={scorecardAvgs[c.orgId]}
                          actionError={actionErrors[c.orgId]}
                          busy={busyOrgId === c.orgId}
                          archivedToast={archivedToastOrgId === c.orgId}
                          onGoArchive={() => { setCardFilter('archived'); setCollapsedGroups((s) => { const n = new Set(s); n.delete('archived'); return n; }); }}
                          confirming={confirming?.orgId === c.orgId ? confirming.action : null}
                          reasonDraft={reasonDraft} onReasonDraft={setReasonDraft}
                          chipsDraft={chipsDraft} onToggleChip={(chip) => setChipsDraft((prev) => (
                            prev.includes(chip) ? prev.filter((c2) => c2 !== chip) : [...prev, chip]))}
                          chipSubreasonDraft={chipSubreasonDraft} onChipSubreason={setChipSubreasonDraft}
                          onStartConfirm={(action) => startConfirm(c.orgId, action)} onCancelConfirm={cancelConfirm}
                          onConfirm={() => act(
                            c.orgId, confirming!.action, confirming!.action === 'pass' ? reasonDraft : undefined,
                            confirming!.action === 'pass' ? chipsDraft : undefined,
                            confirming!.action === 'pass' && chipsDraft.includes('too_early') ? (chipSubreasonDraft ?? undefined) : undefined,
                          )}
                          confirmingWithdraw={confirmingWithdrawOrgId === c.orgId}
                          onStartWithdraw={() => setConfirmingWithdrawOrgId(c.orgId)} onCancelWithdraw={() => setConfirmingWithdrawOrgId(null)}
                          onWithdraw={() => withdrawInterest(c.orgId)}
                          followup={followupsByOrg[c.orgId] ?? null} onRemind={() => remindIn2Weeks(c.orgId)} onCancelReminder={(id) => cancelReminder(id)}
                          onArchive={() => archiveManually(c.orgId)} onOpenLog={() => setInteractionLogOrgId(c.orgId)}
                          onRequestLevel={(level) => requestLevel(c.orgId, level)}
                          menuOpen={menuOpenOrgId === c.orgId} onToggleMenu={() => setMenuOpenOrgId((id) => (id === c.orgId ? null : c.orgId))}
                          wave={unlockedWaves.find((w) => w.items.some((it) => it.orgId === c.orgId)) ?? null}
                          draggable={drag.enabled && (c.pipelineStage === 'new' || c.pipelineStage === 'evaluating' || c.pipelineStage === 'interested' || c.pipelineStage === 'due_diligence')}
                          isDragOrigin={drag.originId === c.orgId}
                          onRowPointerDown={(e) => drag.onRowPointerDown(e, c)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {lockedWave && (
            <div>
              <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                {waveGroupLabel({ kind: lockedWave.kind ?? 'discovery', discoveryIndex: lockedWave.discoveryIndex ?? lockedWave.index })} · {lockedWave.hiddenCount ?? lockedWave.items.length} startups — unlocks when {waveGroupLabel({ kind: 'discovery', discoveryIndex: (lockedWave.discoveryIndex ?? lockedWave.index) - 1 })} is decided
              </p>
              <LockedWave
                hiddenCount={lockedWave.hiddenCount ?? lockedWave.items.length}
                onReview={() => document.getElementById(`wave-${lockedWave.index - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {openOrgId && (
        <aside
          className="sd-dossier-panel-enter flex h-[calc(100vh-24px)] min-w-0 flex-col overflow-hidden rounded-2xl border-l-[3px] border-l-[#0E7490] bg-white shadow-[-12px_0_32px_rgba(15,23,42,0.08)] min-[900px]:sticky min-[900px]:top-3">
          <style>{`
            @keyframes sd-dossier-panel-enter-x { from { transform: translateX(16px); opacity: 0.4; } to { transform: translateX(0); opacity: 1; } }
            .sd-dossier-panel-enter { animation: sd-dossier-panel-enter-x 200ms ease-out; }
            @media (prefers-reduced-motion: reduce) { .sd-dossier-panel-enter { animation: none; } }
          `}</style>
          <Suspense fallback={<LoadingState text="Loading dossier…" compact />}>
            <StartupDossierPanelWithKeyboard
              orgId={openOrgId} orgName={dossierOrgName}
              visibleRowIds={filteredCards.filter((c): c is Card => !isUnavailable(c)).map((c) => c.orgId)}
              onNavigate={(id) => setOpenOrgId(id)}
              onClose={() => setOpenOrgId(null)}
            />
          </Suspense>
        </aside>
      )}
      </div>

      {interactionLogOrgId && (
        <InteractionLogDrawer orgId={interactionLogOrgId}
          orgName={allAnyCards.find((c) => c.orgId === interactionLogOrgId)?.name ?? 'Startup'}
          onClose={() => setInteractionLogOrgId(null)} />
      )}

      {dropUndo && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-xl">
          <span>📦 {dropUndo.name} archived.</span>
          {dropUndo.entryId && (
            <button onClick={() => { reopenArchiveEntry(dropUndo.entryId!); setDropUndo(null); }} className="font-semibold text-[#7DD3E8] hover:underline">
              Undo
            </button>
          )}
        </div>
      )}

      {/* Prompt 715 Pedido B — quiet, no promise of future effect ("vai
          pesar na próxima wave" is fase 4's own language, not this one's). */}
      {chipsRegisteredToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-xl">
          Registered
        </div>
      )}
    </div>
  );
}

// Prompt 681 §3 — ↑/↓ moves between visible rows without closing the panel;
// Esc closes it. A document-level listener, same pattern as the founder
// pipeline page's own (guarded against typing in a form field).
function StartupDossierPanelWithKeyboard({ orgId, orgName, visibleRowIds, onNavigate, onClose }: {
  orgId: string; orgName: string | null; visibleRowIds: string[]; onNavigate: (orgId: string) => void; onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const idx = visibleRowIds.indexOf(orgId);
      if (idx === -1) return;
      const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= visibleRowIds.length) return;
      e.preventDefault();
      onNavigate(visibleRowIds[nextIdx]);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [orgId, visibleRowIds, onNavigate, onClose]);

  return <StartupDossierPageInner orgId={orgId} variant="panel" onClose={onClose} key={orgId} />;
}

// Prompt 681 §2.4 — the redesigned row: avatar · name+one-liner · Fit ·
// stage/round/sectors · Etapa pill · Next action · Last activity · ⋮ menu.
// Express interest stays the primary CTA and Pass the visible destructive
// one (345 §4's own hierarchy); everything else moves into the menu.
function PipelineRow({
  card: c, expanded, openOrgId, onOpen, onToggleExpand, scorecardAvg, actionError, busy, archivedToast, onGoArchive,
  confirming, reasonDraft, onReasonDraft, chipsDraft, onToggleChip, chipSubreasonDraft, onChipSubreason, onStartConfirm, onCancelConfirm, onConfirm,
  confirmingWithdraw, onStartWithdraw, onCancelWithdraw, onWithdraw,
  followup, onRemind, onCancelReminder, onArchive, onOpenLog, onRequestLevel,
  menuOpen, onToggleMenu, wave, draggable, isDragOrigin, onRowPointerDown,
}: {
  card: Card; expanded: boolean; openOrgId: string | null; onOpen: () => void; onToggleExpand: () => void;
  scorecardAvg?: number; actionError?: string; busy: boolean; archivedToast: boolean; onGoArchive: () => void;
  confirming: 'pass' | 'interest' | null; reasonDraft: string; onReasonDraft: (v: string) => void;
  chipsDraft: string[]; onToggleChip: (chip: string) => void; chipSubreasonDraft: string | null; onChipSubreason: (v: string | null) => void;
  onStartConfirm: (action: 'pass' | 'interest') => void; onCancelConfirm: () => void; onConfirm: () => void;
  confirmingWithdraw: boolean; onStartWithdraw: () => void; onCancelWithdraw: () => void; onWithdraw: () => void;
  followup: { id: string; date: string } | null; onRemind: () => void; onCancelReminder: (id: string) => void;
  onArchive: () => void; onOpenLog: () => void; onRequestLevel: (level: 2 | 3) => void;
  menuOpen: boolean; onToggleMenu: () => void; wave: Wave | null;
  draggable: boolean; isDragOrigin: boolean; onRowPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const roundClosesInDays = daysUntil(c.roundTargetCloseDate);
  return (
    <div
      onPointerDown={draggable ? onRowPointerDown : undefined}
      className={`rounded-lg border bg-white transition ${isDragOrigin ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200'} ${draggable ? 'cursor-grab' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <EntityAvatar id={c.orgId} name={c.name} website={c.website} size="sm" />
        <button onClick={onOpen} className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-sm font-semibold text-gray-900 group-hover:underline">{c.name}</span>
              {c.hype && <span className="shrink-0 rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white" title="Hype — trending among investors on your plan">🔥</span>}
              {c.isWatching && <span className="shrink-0 text-[11px]" title="You're watching this startup for changes">👁</span>}
              {/* Prompt 686 A.4 — with the panel open, the collapsed row shows
                  avatar + name + the stage pill (the one-liner already sits
                  in the panel's own header) instead of the one-liner. */}
              {openOrgId ? <StagePill card={c} /> : (c.oneLiner && <span className="block min-w-0 flex-1 truncate text-xs text-gray-500">{c.oneLiner}</span>)}
            </div>
            {!openOrgId && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
                {(c.followOnSignals ?? []).map((s, i) => <FollowOnBadge key={i} signal={s} />)}
                {c.viaPortfolio ? (
                  <span className="font-semibold text-emerald-700" title="You're already invested in this startup — not a new opportunity.">Portfolio</span>
                ) : c.viaReferral ? (
                  <span className="text-purple-700" title={`Referred${c.referredByName ? ` by ${c.referredByName}` : ''}`}>Referred{c.referredByName ? ` by ${c.referredByName}` : ''}</span>
                ) : c.viaGrant || c.viaDecision ? (
                  <span className="text-[#0E7490]" title="A real relationship already exists here.">Invited</span>
                ) : wave ? (
                  <span title={waveGroupLabel({ kind: wave.kind ?? 'discovery', discoveryIndex: wave.discoveryIndex ?? wave.index })}>
                    {waveCardBadge({ kind: wave.kind ?? 'discovery', discoveryIndex: wave.discoveryIndex ?? wave.index })}
                  </span>
                ) : null}
                <FitPill score={c.matchScore} reasons={c.matchReasons} />
                <span>{c.stage && (STAGE_LABELS[c.stage] ?? c.stage)}{fmtEur(c.roundTargetEur) && ` · ${fmtEur(c.roundTargetEur)}`}{c.sectors.length > 0 && ` · ${c.sectors[0]}${c.sectors.length > 1 ? ` +${c.sectors.length - 1}` : ''}`}</span>
                {roundClosesInDays != null && roundClosesInDays >= 0 && roundClosesInDays <= 30 && (
                  <span className="font-medium text-amber-700">Round closes in {roundClosesInDays}d</span>
                )}
              </div>
            )}
          </div>
        </button>
        {!openOrgId && (
          <div className="hidden shrink-0 flex-col items-end gap-0.5 text-right sm:flex">
            <StagePill card={c} />
            <span className={`text-[11px] ${c.nextAction?.overdue ? 'font-medium text-[#B00000]' : 'text-gray-400'}`}>
              {c.nextAction ? c.nextAction.label : '—'}
            </span>
            {c.lastActivityAt && <span className="text-[10px] text-gray-300">Active {fmtDateShort(c.lastActivityAt)}</span>}
          </div>
        )}
        <button onClick={onToggleExpand} className={`shrink-0 rounded-lg border p-1 text-sm transition ${expanded ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-transparent text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-600'}`}>
          {expanded ? '︿' : '⌄'}
        </button>
        <div className="relative shrink-0">
          <button onClick={onToggleMenu} className="rounded-lg border border-transparent p-1 text-sm text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-600">⋮</button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg" data-no-drag>
              {c.pipelineStage === 'interested' && !c.hasGrantedLevel2 && (
                <button onClick={() => onRequestLevel(2)} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">Request full profile</button>
              )}
              {c.hasGrantedLevel2 && !c.hasGrantedLevel3 && !c.hasPendingLevel3Request && (
                <button onClick={() => onRequestLevel(3)} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">Request contact</button>
              )}
              {c.hasPendingLevel3Request && <p className="px-3 py-1.5 text-gray-400">Contact requested — waiting for {c.name}</p>}
              {c.status === 'interested' && c.hasDataRoomAccess && (
                <button onClick={onOpen} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">Open data room</button>
              )}
              {c.status === 'interested' && c.canWithdrawInterest && (
                <button onClick={onStartWithdraw} className="block w-full px-3 py-1.5 text-left text-[#B00000] hover:bg-red-50">Withdraw interest</button>
              )}
              {!c.isArchived && c.status !== 'passed' && (
                <button onClick={onArchive} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">Archive</button>
              )}
              {c.isArchived && <button onClick={onGoArchive} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">Go to Archive to reopen →</button>}
              {followup ? (
                <button onClick={() => onCancelReminder(followup.id)} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">Cancel reminder ({fmtDateShort(followup.date)})</button>
              ) : (
                <button onClick={onRemind} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">Remind me in 2 weeks</button>
              )}
              <button onClick={onOpenLog} className="block w-full px-3 py-1.5 text-left hover:bg-gray-50">🗂 Interaction log</button>
            </div>
          )}
        </div>
      </div>

      {c.status === 'open' && !confirming && (
        <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2">
          <button onClick={() => onStartConfirm('interest')} disabled={busy} className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">Express interest</button>
          <button onClick={() => onStartConfirm('pass')} className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-[#B00000] hover:border-[#B00000] hover:bg-red-50">Pass</button>
        </div>
      )}

      {confirming && (
        <div className="border-t border-gray-100 p-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            {confirming === 'interest' ? (
              <p className="text-xs text-gray-700">Confirm you&apos;re interested in {c.name}? The founder will be notified.</p>
            ) : (
              <>
                <p className="mb-1 text-sm font-bold text-[#B00000]">Pass on {c.name} — this is final</p>
                <label className="mb-1 block text-xs font-medium text-gray-700">Reason for passing (required, sent to the founder)</label>
                <textarea value={reasonDraft} onChange={(e) => onReasonDraft(e.target.value.slice(0, REASON_MAX_LEN))}
                  rows={3} placeholder="Why isn't this a fit right now?" className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
                <p className="mt-0.5 text-[11px] font-medium text-[#B00000]">The data room will be revoked and this can&apos;t be undone.</p>
                <p className="text-[10px] text-gray-400">{reasonDraft.length}/{REASON_MAX_LEN}</p>
                {/* Prompt 715 Pedido B — private, optional, never sent to the founder. */}
                <label className="mb-1 mt-2 block text-xs font-medium text-gray-700">For you only (optional, never shared with the founder)</label>
                <div className="flex flex-wrap gap-1.5">
                  {PASS_REASON_CHIPS.map((chip) => (
                    <button key={chip.id} type="button" onClick={() => onToggleChip(chip.id)}
                      className={`rounded-full border px-2 py-1 text-[11px] font-medium transition ${chipsDraft.includes(chip.id) ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
                      {chip.label}
                    </button>
                  ))}
                </div>
                {chipsDraft.includes('too_early') && (
                  <div className="mt-1.5">
                    <p className="mb-1 text-[11px] text-gray-500">What would need to change? (optional)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TOO_EARLY_SUBREASONS.map((sub) => (
                        <button key={sub.id} type="button" onClick={() => onChipSubreason(chipSubreasonDraft === sub.id ? null : sub.id)}
                          className={`rounded-full border px-2 py-1 text-[11px] font-medium transition ${chipSubreasonDraft === sub.id ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button onClick={onCancelConfirm} disabled={busy} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-white disabled:opacity-40">Cancel</button>
              <button onClick={onConfirm} disabled={busy || (confirming === 'pass' && reasonDraft.trim().length === 0)}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {busy ? 'Saving…' : confirming === 'interest' ? 'Confirm interest' : 'Confirm pass'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingWithdraw && (
        <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
          The founder hasn&apos;t seen this yet — withdraw?
          <button onClick={onWithdraw} disabled={busy} className="ml-2 font-medium text-[#B00000] hover:underline disabled:opacity-40">Yes</button>
          <button onClick={onCancelWithdraw} className="ml-2 text-gray-400 hover:underline">No</button>
        </div>
      )}

      {archivedToast && (
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-1.5 text-xs text-gray-600">
          <span>Archived — you&apos;ll find it in the Archive group.</span>
          <button onClick={onGoArchive} className="font-medium text-[#0E7490] hover:underline">Go to Archive →</button>
        </div>
      )}
      {actionError && <p className="border-t border-gray-100 px-3 py-1.5 text-xs text-[#B00000]">{actionError}</p>}

      {expanded && (c.description || c.introProblem || c.introSolution || c.trackingCount > 0 || c.passReason || c.isArchived) && (
        <div className="border-t border-gray-100 px-3 py-3">
          {c.status === 'passed' && <p className="text-xs text-gray-400">Passed{fmtDecidedAt(c.decidedAt, c.decidedByMe)}{c.passReason && ` — ${c.passReason}`}</p>}
          {c.isArchived && <p className="text-[11px] font-medium text-gray-400">📦 Archived{c.archivedAt ? ` on ${fmtDateShort(c.archivedAt)}` : ''}</p>}
          {c.description && <p className="text-xs text-gray-600">{c.description}</p>}
          {(c.introProblem || c.introSolution) && (
            <div className="mt-1 space-y-0.5">
              {c.introProblem && <p className="text-xs text-gray-600"><span className="font-medium text-gray-500">Problem: </span>{c.introProblem}</p>}
              {c.introSolution && <p className="text-xs text-gray-600"><span className="font-medium text-gray-500">Solution: </span>{c.introSolution}</p>}
            </div>
          )}
          {c.trackingCount > 0 && (
            <p className="mt-1.5 text-xs text-gray-400">{c.trackingCount} other investor{c.trackingCount === 1 ? ' is' : 's are'} tracking {c.stage ? (STAGE_LABELS[c.stage] ?? c.stage) : 'this stage'} rounds</p>
          )}
          {scorecardAvg != null && (
            <p className="mt-1.5 text-xs font-semibold text-amber-700">★ {scorecardAvg}/10 your scorecard average</p>
          )}
        </div>
      )}
    </div>
  );
}
