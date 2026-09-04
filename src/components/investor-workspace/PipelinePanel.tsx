'use client';
// Investor Workspace Pipeline (prompt 58) — startups presented in waves by
// match score. Mirrors the founder-side pipeline's doseamento principle:
// only the current wave is actionable, the rest stay locked until it's
// fully treated (every card passed or expressed interest on).
import { Fragment, useEffect, useState } from 'react';
import { FrostedGate } from '@/components/workspace-shell/FrostedGate';
import Link from 'next/link';
import { InteractionLogDrawer } from './InteractionLogDrawer';
import { ArchivePanel } from './ArchivePanel';
import { WatchingPanel } from './WatchingPanel';
import { FollowOnBadge } from '../FollowOnBadge';
import type { FollowOnPayload } from '@/lib/network';
import { waveCardBadge, waveGroupLabel, type PipelineWaveKind } from '@/lib/pipeline-waves';
import { pipelineQuotaLine, type PipelineQuota } from '@/lib/pipeline-quota-line';

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
  // Prompt 345 §B — whether the withdraw window is still open; false for
  // every status other than 'interested' with a real decision. Computed
  // server-side at Pipeline-load time (never lazily on expand).
  canWithdrawInterest?: boolean;
  // Prompt 345 §C.1 — "In conversation" for the interested-card status
  // line: at least one deal_messages row exists in the thread, either side.
  hasConversation?: boolean;
}
// Prompt 556 §C — a startup whose org was closed (its last member deleted)
// arrives as THIS instead of a Card: the four fields the investor's own
// history needs, and nothing about the startup. The server builds it
// (closed-org-card.ts, projectUnavailableCard) — this is not a client-side
// filter of a full card, and there is no full card to fall back to.
interface UnavailableCard {
  orgId: string; name: string; status: 'open' | 'passed' | 'interested';
  decidedAt?: string | null; unavailable: true;
}
type AnyCard = Card | UnavailableCard;
function isUnavailable(c: AnyCard): c is UnavailableCard {
  return (c as UnavailableCard).unavailable === true;
}

// Item 14 — a locked wave's `items` now arrives empty from the server
// (/api/portal/pipeline strips real card data for any wave with
// unlocked=false); hiddenCount is the only signal of what's behind it.
//
// Prompt 850 §C — `index` is the DOM id and the "Review the wave above"
// scroll target, nothing else. Every label comes from kind/discoveryIndex:
// the relationship group is not a wave and is never numbered, and discovery
// numbers from 1 regardless of whether a relationship group sits above it.
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
type StatusFilterValue = 'all' | 'open' | 'interested' | 'passed' | 'archived' | 'watching';
const STATUS_FILTERS: { value: StatusFilterValue; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'No decision' }, { value: 'interested', label: 'Interested' }, { value: 'passed', label: 'Passed' },
  // Prompt 337 — the standalone "Archive" tab is gone; same content
  // (ArchivePanel, unchanged), same source of truth, reached as a filter
  // pill here instead — the investor shell no longer has a 9th tab for it.
  { value: 'archived', label: 'Archived' },
  // Prompt 348 — same "reached as a filter pill, not its own tab" pattern.
  { value: 'watching', label: 'Watching' },
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

// Prompt 345 §C.1 — "não há botões para consultar o estado": the most
// advanced signal already on the card, read in order (a real conversation
// implies access was granted at some point, so it wins outright).
function interestResponseLabel(c: Card): string {
  if (c.hasConversation) return 'In conversation';
  if (c.hasDataRoomAccess) return 'Access granted';
  return 'No response yet';
}

// Item 14 — replaces the old opacity-50 treatment, which left the real
// (locked) card data sitting in the DOM, readable and selectable — the
// server no longer sends that data at all (see the Wave/hiddenCount
// comment above), so this renders skeleton rows only. No `position: fixed`
// element lives inside this overlay — a backdrop-blur ancestor becomes the
// containing block for any fixed descendant, which is exactly what broke
// the MatchDeal pairing modal (see CLAUDE.md's note on that bug); the
// "Review" button here just scrolls, it never opens a modal.
// Prompt 556 §C — the whole card for a startup that no longer exists: the
// name in muted text and one line. No status pill, no match score, no
// Interested/Pass/Archive/Message/Data room, no expand, and no <Link> — the
// dossier route answers 410 for a closed org, so a click-through would only
// be a dead end. There is nothing to disable here because nothing is
// rendered; that is deliberate, and it is why this is its own component
// rather than a set of conditionals inside the real card.
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

function LockedWave({ hiddenCount, onReview }: { hiddenCount: number; onReview: () => void }) {
  // Prompt 554 — this block is always locked (it IS the lock), and seven
  // 56px placeholder rows plus gaps can exceed a short viewport, so the
  // explanation and its button now stick to the viewport instead of the
  // block's middle. rounded-lg (not the gate's default 2xl) preserved.
  return (
    <FrostedGate
      locked
      overlayClassName="rounded-lg backdrop-blur-sm"
      message={<span className="text-2xl">🔒</span>}
      note={(
        <p className="text-sm font-semibold text-gray-700">
          {hiddenCount} more startup{hiddenCount === 1 ? '' : 's'} unlock{hiddenCount === 1 ? 's' : ''} when you&apos;ve treated this wave
        </p>
      )}
      cta={(
        <button onClick={onReview} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0c637b]">
          Review the wave above
        </button>
      )}
    >
      <div className="space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[56px] rounded-lg border border-gray-100 bg-gray-100" />
        ))}
      </div>
    </FrostedGate>
  );
}

// Prompt 345 Block E — compareIds/showComparison (P169 §B) are gone: the
// comparator (checkbox-per-row + banner + ComparisonView) moved to
// Evaluation tools' own "Compare startups" entry, which now owns that state
// locally since it never needs to survive a trip across tabs anymore.
export function PipelinePanel({ onOpenStartup }: {
  onOpenStartup: (orgId: string) => void;
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
  // Prompt 345 §A.2 — per-card now, not one global banner floating above
  // the whole wave list: archiveManually used to fail 403 with nothing
  // shown anywhere (the response body was never read), and even act()'s own
  // error rendered far from the card that caused it on a long list. Keyed
  // by orgId so each card's own error is independent and never bleeds onto
  // a different card's retry.
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
  // Item 8 — archiving worked (the entry landed in the Archive tab fine)
  // but gave zero feedback where the click happened: same card, same
  // buttons, nothing. The persistent "Archived" badge (isArchived, from the
  // server) fixes the state half of that; this is the one-time toast for
  // the moment it just happened.
  const [archivedToastOrgId, setArchivedToastOrgId] = useState<string | null>(null);
  // P133 (item 10) — which card's Interaction log drawer is open, if any.
  const [interactionLogOrgId, setInteractionLogOrgId] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  // Prompt 345 §C.2 — reload-proof now: keyed off the Agenda's own
  // investor_followups rows (kind 'follow_up', not done), not an ephemeral
  // client flag that forgot itself on refresh.
  const [followupsByOrg, setFollowupsByOrg] = useState<Record<string, { id: string; date: string }>>({});
  // Prompt 345 §B — separate from `confirming` (pass/interest) on purpose:
  // that state drives a bigger reason-collecting box; this is a one-line
  // "are you sure?" per the prompt's own copy.
  const [confirmingWithdrawOrgId, setConfirmingWithdrawOrgId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  // Prompt 337 — count for the "Archived" filter pill. A separate small
  // fetch rather than deriving from `data.waves` cards' own `isArchived`
  // flag: an archived org can already have dropped out of the Pipeline's
  // eligible set entirely (a different table, investor_archive_entries,
  // not a subset of what's currently in waves), so counting only currently-
  // visible cards would silently undercount.
  const [archivedCount, setArchivedCount] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/portal/archive').then((r) => r.json()).then((d) => setArchivedCount((d.entries ?? []).length)).catch(() => setArchivedCount(null));
  }, []);
  // Prompt 348 — same reasoning as archivedCount above: watches are their
  // own table (investor_watches), not a subset of `waves`.
  const [watchingCount, setWatchingCount] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/portal/watchlist').then((r) => r.json()).then((d) => setWatchingCount((d.items ?? []).length)).catch(() => setWatchingCount(null));
  }, []);
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
  // Prompt 345 §C.2 — same fetch, now also builds the reload-proof
  // reminder map (see followupsByOrg above) instead of a second call.
  function loadAgenda() {
    fetch('/api/portal/agenda').then((r) => r.json()).then((d) => {
      const items = (d.items ?? []) as { kind: string; orgId?: string; followupId?: string; date: string }[];
      setMeetingsCount(items.filter((i) => i.kind === 'meeting').length);
      const followups: Record<string, { id: string; date: string }> = {};
      for (const i of items) if (i.kind === 'follow_up' && i.orgId && i.followupId) followups[i.orgId] = { id: i.followupId, date: i.date };
      setFollowupsByOrg(followups);
    }).catch(() => { setMeetingsCount(null); setFollowupsByOrg({}); });
  }
  useEffect(loadAgenda, []);
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

  function load() {
    fetch('/api/portal/pipeline').then((r) => r.json()).then(setData);
  }
  useEffect(load, []);

  function startConfirm(orgId: string, action: 'pass' | 'interest') {
    setCardError(orgId, null);
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
    setCardError(orgId, null);
    try {
      const res = await fetch('/api/portal/pipeline', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        // AP-14 — a teammate may have decided first; surface it plainly and
        // reload so this card reflects the actual (org-level) outcome.
        setCardError(orgId, body.error ?? 'Something went wrong — please try again.');
      } else {
        setConfirming(null);
        setReasonDraft('');
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
    loadAgenda();
  }

  // Prompt 345 §C.2 — cancel, not "mark done": this reminder was never
  // acted on. DELETE (added alongside PATCH's own "mark done") on the same
  // investor_followups table.
  async function cancelReminder(followupId: string) {
    await fetch(`/api/portal/agenda?id=${encodeURIComponent(followupId)}`, { method: 'DELETE' });
    loadAgenda();
  }

  // Archive (prompt 60) — manual archive, distinct from a pass: the
  // investor sets it aside without recording a "why not" swipe reason.
  async function archiveManually(orgId: string) {
    setBusyOrgId(orgId);
    setArchivedToastOrgId(null);
    setCardError(orgId, null);
    try {
      const res = await fetch('/api/portal/archive', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archiveOrgId: orgId }),
      });
      const body = await res.json().catch(() => ({}));
      // Prompt 345 §A.2 — this used to check only res.ok and never read the
      // body: a 403 (wrong authorization predicate, fixed in the route
      // itself) failed completely silently, same click, same button, no
      // sign anything went wrong. Every failure now surfaces on this card.
      if (!res.ok || body.ok === false) setCardError(orgId, body.error ?? 'Could not archive — please try again.');
      else setArchivedToastOrgId(orgId);
      load();
    } finally { setBusyOrgId(null); }
  }

  // Prompt 345 §B — the window check runs again server-side on this exact
  // call; the button only ever having been shown (c.canWithdrawInterest)
  // isn't the real gate.
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
      load();
    } finally { setBusyOrgId(null); }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const waves = data.waves ?? [];
  const quotaLine = pipelineQuotaLine(data.quota, new Date().toISOString());
  const firstUnlocked = waves.find((w) => w.unlocked);

  // Prompt 337 — an investor with zero active waves can still have real
  // Archive entries (a different table, not a subset of `waves`); the
  // Archived filter must stay reachable even in that state, not swallowed
  // by this early "nothing yet" return.
  if (waves.length === 0 && statusFilter !== 'archived') {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">More startups joining — you&apos;ll be notified when a new match arrives.</p>
        {archivedCount != null && archivedCount > 0 && (
          <button onClick={() => setStatusFilter('archived')} className="mt-2 text-xs text-[#0E7490] hover:underline">
            View Archived ({archivedCount}) →
          </button>
        )}
      </div>
    );
  }

  const allAnyCards = waves.flatMap((w) => w.items);
  // Prompt 556 §C — everything below reads startup ATTRIBUTES (sectors,
  // country, stage, data-room state). A closed org has none of them, by
  // construction, so it is excluded here rather than each reader having to
  // guard: a closed startup is not a filter option and is not a funnel
  // number. It still renders as a row, from allAnyCards.
  const allCards = allAnyCards.filter((c): c is Card => !isUnavailable(c));
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
  // Prompt 345 §A.3 — isArchived excluded from "All" the same way, on its
  // own terms: an archived card no longer necessarily has status 'passed'
  // (archiving stopped writing a pass swipe), so this can't be left to
  // fall out of the status check above by accident anymore.
  function passesFilter(c: AnyCard) {
    // Prompt 556 §C — a closed startup answers the status filter (the
    // investor's own decision is still theirs) and nothing else. It has no
    // sector, country or stage, so any of those filters legitimately hides
    // it rather than the code inventing a value to compare.
    if (isUnavailable(c)) {
      if (statusFilter === 'all' ? c.status === 'passed' : c.status !== statusFilter) return false;
      return sectorFilter === 'all' && countryFilter === 'all' && stageFilter === 'all';
    }
    if (statusFilter === 'all' ? (c.status === 'passed' || c.isArchived) : c.status !== statusFilter) return false;
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
  // Prompt 345 §D.5 — "Tracking" renamed "No decision" (clearer than the
  // old label for a card nobody has acted on yet); filterValue is set only
  // for the two rows that actually correspond to a STATUS_FILTERS value —
  // Data room open/Meetings aren't a status, so their bars stay static.
  const overviewStats: { label: string; n: number; filterValue?: StatusFilterValue }[] = [
    { label: 'No decision', n: allCards.filter((c) => c.status === 'open').length, filterValue: 'open' },
    { label: 'Interested', n: allCards.filter((c) => c.status === 'interested').length, filterValue: 'interested' },
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
    // Prompt 345 §D.1 — max-w-2xl (672px) is gone; the shell now gives this
    // tab the same max-w-6xl real estate as Plans/My Network.
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Pipeline</h1>
        <a href="/api/portal/export?type=pipeline" className="text-xs text-gray-400 hover:underline">Export CSV</a>
      </div>
      {/* Prompt 850 §D — what the monthly plan cap is actually doing, from
          the server's own admission numbers. Absent (null) rather than a
          placeholder when there is no linked investor firm to have a cap. */}
      {quotaLine && <p className="-mt-2 text-xs text-gray-500">{quotaLine}</p>}
      <div data-tour-id="investor-pipeline-overview" className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="grid items-center gap-x-2 gap-y-1.5 text-sm" style={{ gridTemplateColumns: '7rem 1fr 2.5rem' }}>
          {overviewStats.map((s) => {
            // Prompt 345 §D.5 — only the two rows with a corresponding
            // status filter are clickable (Data room open/Meetings aren't a
            // status); the three cells stay individually-styled grid items
            // (not wrapped in one button) so the shared column template
            // above is untouched — each just gets its own onClick.
            const onClick = s.filterValue !== undefined ? () => setStatusFilter(s.filterValue!) : undefined;
            const clickableCls = onClick ? 'cursor-pointer hover:underline' : '';
            return (
              <Fragment key={s.label}>
                <span onClick={onClick} className={`text-xs ${onClick ? 'font-medium text-[#0E7490]' : 'text-gray-500'} ${clickableCls}`}>{s.label}</span>
                <div onClick={onClick} className={`h-4 rounded bg-[#0E7490]/80 ${clickableCls}`} style={{ width: `${Math.max(4, s.n / overviewMax * 100)}%` }} />
                <span onClick={onClick} className={`text-right text-xs font-medium ${clickableCls}`}>{s.n}</span>
              </Fragment>
            );
          })}
        </div>
        {overviewAllZero && (
          <p className="mt-2 text-xs text-gray-400">No activity yet — this fills in as you and other investors review startups on the platform.</p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            title={f.value === 'all' ? 'Passed and Archived live in their own filters.' : undefined}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusFilter === f.value ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {f.label}{f.value === 'archived' && archivedCount != null ? ` (${archivedCount})` : ''}{f.value === 'watching' && watchingCount != null ? ` (${watchingCount})` : ''}
          </button>
        ))}
      </div>
      {/* Prompt 345 §D.6 — a short, always-visible legend rather than only
          a hover tooltip (Nuno's own "tooltip ou legenda" gave either); a
          hidden-until-hover title is easy to miss on a filter row that
          reads as self-explanatory at a glance. */}
      <p className="text-[11px] text-gray-400">Passed and Archived live in their own filters.</p>
      {statusFilter === 'archived' ? (
        <ArchivePanel />
      ) : statusFilter === 'watching' ? (
        <WatchingPanel onOpenStartup={onOpenStartup} />
      ) : (
      <>
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

      {/* Prompt 189 — own vertical scroll capped at ~15 cards so the list
          doesn't grow the whole page; max-height (not a hard height) so a
          short pipeline still shrinks to fit rather than leaving dead
          white space below it, same reasoning as the founder-side table
          (Prompt 188 §1). Wave-unlock mechanism and LockedWave are
          untouched — they scroll normally as part of this same list. */}
      <div data-tour-id="investor-pipeline-list" className="space-y-4 overflow-y-auto" style={{ maxHeight: PIPELINE_CARD_LIST_MAX_HEIGHT_PX }}>
      {waves.map((wave) => (
        <div key={wave.index} id={`wave-${wave.index}`}>
          {/* Prompt 850 §C — the relationship group always shows its own
              header (it is the one that used to be mislabelled "WAVE 1"),
              even when it is the only group; wave numbering only appears
              once there is more than one discovery wave to distinguish. */}
          {(waves.length > 1 || wave.kind === 'relationships') && (
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              {waveGroupLabel({ kind: wave.kind ?? 'discovery', discoveryIndex: wave.discoveryIndex ?? wave.index })}
              {!wave.unlocked && ' — locked until the wave above is treated'}
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
              if (isUnavailable(c)) return <UnavailableRow key={c.orgId} card={c} />;
              const expanded = expandedIds.has(c.orgId);
              return (
              <div key={c.orgId} className="rounded-lg border border-gray-200 bg-white">
                {/* P134-A — collapsed row: ~52-60px, triage information only.
                    Secondary actions and the fuller description only ever
                    appear once expanded (below) — the calculator has no
                    presence here at all anymore (it lives in Evaluation
                    tools + the dossier header, per the mini-prompt). */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {/* Prompt 345 Block E — the per-row compare checkbox is
                      gone; comparing now happens entirely in Evaluation
                      tools' own "Compare startups" picker. */}
                  <button onClick={() => toggleExpanded(c.orgId)} className="group flex min-w-0 flex-1 items-center gap-2 text-left">
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
                        <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-medium text-[#0E7490]" title={interestResponseLabel(c)}>
                          Interested{fmtDecidedAt(c.decidedAt, c.decidedByMe)} · {interestResponseLabel(c)}
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
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500" title={waveGroupLabel({ kind: wave.kind ?? 'discovery', discoveryIndex: wave.discoveryIndex ?? wave.index })}>
                          {waveCardBadge({ kind: wave.kind ?? 'discovery', discoveryIndex: wave.discoveryIndex ?? wave.index })}
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
                    {/* Prompt 345 §D.4 — visible at every breakpoint now,
                        not just lg+: archived status shouldn't disappear on
                        a narrower window. */}
                    {c.isArchived && <span className="shrink-0 text-[11px] text-gray-400" title="Archived">📦</span>}
                    {/* Prompt 345 §D.2 — the bare 12px chevron is gone; this
                        is now a real, hoverable expand affordance (bigger
                        glyph, its own rounded hover background) while the
                        whole row (this span's own parent button) stays
                        clickable exactly as before. */}
                    <span className={`shrink-0 rounded-lg border p-1 text-sm transition ${expanded ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-transparent text-gray-400 group-hover:border-gray-200 group-hover:bg-gray-50 group-hover:text-gray-600'}`}>
                      {expanded ? '︿' : '⌄'}
                    </span>
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
                        <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-medium text-[#0E7490]">Interested{fmtDecidedAt(c.decidedAt, c.decidedByMe)} · {interestResponseLabel(c)}</span>
                      ) : c.viaReferral ? (
                        <span className="rounded-full bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700">Referred{c.referredByName ? ` by ${c.referredByName}` : ''}</span>
                      ) : c.viaGrant || c.viaDecision ? (
                        <span className="rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-medium text-[#0E7490]">Invited</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">{waveCardBadge({ kind: wave.kind ?? 'discovery', discoveryIndex: wave.discoveryIndex ?? wave.index })}</span>
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
                        <button onClick={() => setStatusFilter('archived')} className="font-medium text-[#0E7490] hover:underline">Go to Archive →</button>
                      </div>
                    )}
                    {/* Prompt 345 §A.2 — same visual pattern as the confirm
                        box's own error state, right on the card that caused
                        it, regardless of which action (Express interest,
                        Pass, Archive) failed. */}
                    {actionErrors[c.orgId] && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{actionErrors[c.orgId]}</p>
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
                          Archive
                        </button>
                        {/* Prompt 345 §B — discreet, next to the rest of the
                            row rather than a primary action: withdrawing is
                            an edge case, not the expected path. */}
                        {confirmingWithdrawOrgId === c.orgId ? (
                          <span className="flex items-center gap-1.5 text-xs text-gray-500">
                            The founder hasn&apos;t seen this yet — withdraw?
                            <button onClick={() => withdrawInterest(c.orgId)} disabled={busyOrgId === c.orgId}
                              className="font-medium text-[#B00000] hover:underline disabled:opacity-40">Yes</button>
                            <button onClick={() => setConfirmingWithdrawOrgId(null)} className="text-gray-400 hover:underline">No</button>
                          </span>
                        ) : c.canWithdrawInterest ? (
                          <button onClick={() => setConfirmingWithdrawOrgId(c.orgId)} className="text-xs text-gray-400 hover:underline">
                            Withdraw interest
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">The founder has already responded — this can no longer be withdrawn.</span>
                        )}
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
                      // Prompt 345 §D.3 — two-tier hierarchy: Express
                      // interest (primary) and Pass (destructive) are the
                      // two decisions this row exists for, full visual
                      // weight, same as before. Everything else (Interaction
                      // log, Archive, Remind me, Open data room when it
                      // exists) is real but secondary — a lighter second
                      // line, not a hidden "⋯" menu, since none of these are
                      // rare enough to bury (Interaction log and Remind me
                      // in particular are common, everyday actions).
                      <div className="mt-2 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => startConfirm(c.orgId, 'interest')} disabled={busyOrgId === c.orgId}
                            className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                            Express interest
                          </button>
                          {/* Prompt 214 §A.1 — Pass e uma accao FINAL que
                              revoga o data room. O peso visual tem de
                              corresponder ao peso da consequencia. */}
                          <button onClick={() => startConfirm(c.orgId, 'pass')}
                            className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-[#B00000] hover:border-[#B00000] hover:bg-red-50">
                            Pass
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5 text-xs text-gray-500">
                          {/* P120 Block A — a card without a grant is
                              eligible by published profile alone; the data
                              room stays gated on the founder actually
                              consenting (access_grants). That trust
                              boundary doesn't move — only discovery does. */}
                          {c.hasDataRoomAccess ? (
                            <button onClick={() => onOpenStartup(c.orgId)} className="hover:text-[#0E7490] hover:underline">
                              Open data room
                            </button>
                          ) : (
                            <span className="text-gray-400">🔒 Access is granted by the founder — express interest to start the conversation.</span>
                          )}
                          <button onClick={() => setInteractionLogOrgId(c.orgId)} className="hover:text-[#0E7490] hover:underline">
                            🗂 Interaction log
                          </button>
                          <button onClick={() => archiveManually(c.orgId)} disabled={busyOrgId === c.orgId} className="hover:text-[#0E7490] hover:underline disabled:opacity-40">
                            Archive
                          </button>
                          {/* Prompt 345 §C.2 — the concrete date, reload-
                              proof (followupsByOrg, from the Agenda's own
                              storage), with a × to cancel outright rather
                              than a session flag that forgot itself on
                              refresh. */}
                          {followupsByOrg[c.orgId] ? (
                            <span className="flex items-center gap-1">
                              Reminder: {new Date(followupsByOrg[c.orgId].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              <button onClick={() => cancelReminder(followupsByOrg[c.orgId].id)} title="Cancel reminder" className="text-gray-400 hover:text-[#B00000]">×</button>
                            </span>
                          ) : (
                            <button onClick={() => remindIn2Weeks(c.orgId)} className="hover:underline">
                              Remind me in 2 weeks
                            </button>
                          )}
                        </div>
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
      </>
      )}
      {interactionLogOrgId && (
        <InteractionLogDrawer orgId={interactionLogOrgId}
          orgName={allAnyCards.find((c) => c.orgId === interactionLogOrgId)?.name ?? 'Startup'}
          onClose={() => setInteractionLogOrgId(null)} />
      )}
    </div>
  );
}
