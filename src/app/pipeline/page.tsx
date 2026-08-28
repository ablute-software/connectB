'use client';
// Pipeline (home) — dense sortable/filterable entity table
import { useEffect, useMemo, useState } from 'react';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { FitTag, StatusPill, Tooltip, WaveTag, fmtEur, statusLabel } from '@/components/ui';
import { LoadingState } from '@/components/workspace-shell/LoadingState';
import { MatchDealVisibilityBanner } from '@/components/dashboard/MatchDealVisibilityBanner';
import { RelationshipCompactLine } from '@/components/RelationshipSummaryCard';
import { ReawakeningQueue } from '@/components/ReawakeningQueue';
import { AddInvestorModal } from '@/components/AddInvestorModal';
import { followUpTaskDisplayTitle, isPersonCandidate, isUnverifiedStub, relationshipSummary } from '@/lib/relationship';
import { CoachMark } from '@/components/onboarding/CoachMark';
import { PageTour } from '@/components/onboarding/PageTour';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';
import { useTrackPageView } from '@/lib/use-track-page-view';
import { nextMonthlyDeliveryDate } from '@/lib/catalog-monthly-delivery';
import { classifyEntityFrozenState, type EntityFrozenState } from '@/lib/frozen-classifier';
import { viewForFrozenState, pillLabelForFrozenState } from '@/lib/frozen-view-grouping';
import type { NeglectOutcome } from '@/lib/neglect-evaluation';
import { competitorInvestmentSummary, type CompetitorInvestmentItem } from '@/lib/competitor-investment-copy';
import type { Db, Entity, Interaction, TaskItem } from '@/lib/types';

const fitOrder = { high: 0, medium_high: 1, medium: 2, low: 3 };
const SORT_STORAGE_KEY = 'ablute-pipeline-sort-v1';

// Prompt 188 §1 — measured in the actual render (demo data, DevTools),
// not guessed: thead is 32.5px, a single-line row (no relationship line,
// no reopen-trigger note, no wrapped next-action text) is 57px. Rows with
// that extra content wrap taller — table cells wrap instead of truncating
// by design (see the SORT_COLUMNS comment above) — so a wave with a lot of
// annotated rows will show a little under 15 before the scrollbar kicks
// in; there's no fixed-height table design that avoids that trade-off
// without truncating content the app deliberately never truncates.
const PIPELINE_LIST_MAX_HEIGHT_PX = 888; // 32.5 (thead) + 15 * 57 (row), rounded up

// Column widths sum to 100% — table-fixed (below) then holds the table to
// the container's width at every "wave" filter setting instead of growing
// with content and forcing horizontal scroll. Cell text wraps instead of
// truncating (see the td classes below) so nothing gets cut off silently.
// Prompt 304 §2 — reallocated: Type/HQ/Check/Fit/Wave carry short, mostly-
// fixed-format text ("W1", "Med-High", "€250K–€1M") and can afford to give
// up space; Entity and Sectors carry the most real content (name + up to 6
// badges + RelationshipCompactLine; 2 sector chips + "+N") and get it.
// Verified against a worst-case row (Overdue + 2 long sector names + an
// extra badge) at both 1440px and 1280px — see the verification note above
// the table's own render for what was actually checked, not just eyeballed.
const SORT_COLUMNS = [
  { key: 'name', label: 'Entity', width: '27%' }, { key: 'type', label: 'Type', width: '7%' },
  { key: 'hq', label: 'HQ', width: '9%' }, { key: 'check', label: 'Check', width: '8%' },
  { key: 'sectors', label: 'Sectors', width: '18%' }, { key: 'fit', label: 'Fit', width: '5%' },
  { key: 'wave', label: 'Wave', width: '4%' }, { key: 'status', label: 'Status', width: '9%' },
  { key: 'next_action', label: 'Next action', width: '13%' },
] as const;
type SortKey = typeof SORT_COLUMNS[number]['key'];
const SORT_KEYS = SORT_COLUMNS.map((c) => c.key) as SortKey[];

// Generic nulls-last comparator so every column sorts sensibly without a
// bespoke comparator per key — string/number/boolean all handled the same
// way, missing values always sink to the bottom regardless of direction.
function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1;
  return 0;
}

function nextAction(db: Db, e: Entity): TaskItem | undefined {
  return db.tasks.filter((t) => t.entity_id === e.id && !t.done)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))[0];
}

// "Last update" tag for the top-of-page summary cards. Built entirely from
// real fields (interaction channel/direction/classification, open task
// deadlines) — no mockup was available to match exactly (asked for a
// resend), so this is a best-effort reading of the same underlying data
// rather than a pixel-match; the shape (name + one short status tag) is
// what was specified even without the image.
function lastUpdateTag(db: Db, e: Entity): string | null {
  const task = nextAction(db, e);
  if (task?.due_at) {
    const daysOut = (new Date(task.due_at).getTime() - Date.now()) / 86_400_000;
    if (daysOut < 0) return 'Follow-up overdue';
    if (daysOut <= 3) return `Follow-up due · ${task.due_at.slice(5, 10)}`;
  }
  const interactions = db.interactions.filter((i) => i.entity_id === e.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const latest = interactions[0];
  if (!latest) return null;
  if (latest.classification === 'meeting_request' || latest.channel === 'meeting') return 'Meeting requested';
  if (latest.classification === 'interested') return 'Warm — interested';
  if (latest.direction === 'in') return 'Replied';
  const isFirstOutbound = latest.direction === 'out' && interactions.length === 1;
  if (isFirstOutbound) return 'Intro sent';
  if (latest.direction === 'out') return 'Follow-up sent';
  return null;
}

// Prompt 258 — a card in the top-of-page "recent activity" spotlight can
// silently drop out of it the moment another entity has fresher activity
// (updateCards keeps only the 6 most recent, sorted by latest.occurred_at).
// If that card represented a request still awaiting the founder's reply, it
// can vanish from sight unanswered. This escalates the card's own color
// green light->vivid across 4 days so it visibly demands attention before
// it falls out of the top 6, instead of just quietly disappearing.
//
// "Pending request" reuses lastUpdateTag's own inbound tags verbatim — no
// new classification invented, per the prompt's own instruction. Every tag
// lastUpdateTag can return for an inbound interaction ('Meeting requested',
// 'Warm — interested', the generic 'Replied' for any other inbound
// classification incl. question/unclear/awaiting) means exactly "they did
// something, we haven't answered" — which is also exactly the condition
// `latest.direction === 'in'` captures on its own: if the founder HAD
// replied since, that reply (an outbound interaction) would itself be
// `latest`, and lastUpdateTag would already say 'Follow-up sent'/'Intro
// sent' instead. So the founder-replied closing condition (§4) falls out
// for free from the same check that decides whether to escalate at all —
// no separate "has this been answered" query needed.
//
// Deliberately NOT integrated here: access_requests (migration 0178, the
// data-room "request access" flow) — it's a wholly separate table with no
// automatic interaction insert, invisible to updateCards today regardless
// of this prompt (updateCards only ever reads db.interactions). Folding it
// in would need a new bulk fetch resolving person_id -> people.entity_id,
// the same shape as Prompt 257's investor-interest/messages extensions —
// flagged as a real gap, left out of this pass to avoid scope creep beyond
// what's already visible in updateCards.
//
// The other closing condition (§4) — the case is closed, not answered —
// entity.status already says so directly: dormant (frozen), passed, or
// invested all mean "not an open ask anymore," so escalation simply never
// applies to those regardless of how recent/inbound the interaction is.
function pendingRequestEscalationTier(entity: Entity, latest: Interaction | undefined, now: Date): 1 | 2 | 3 | 4 | null {
  if (!latest || latest.direction !== 'in') return null;
  if (entity.status === 'dormant' || entity.status === 'passed' || entity.status === 'invested') return null;
  const daysSince = Math.floor((now.getTime() - new Date(latest.occurred_at).getTime()) / 86_400_000);
  // Day 1 (the request's own day) starts at the lightest tone; day 4
  // onward stays at the most vivid one — "não escalar mais" past day 4,
  // per the prompt's own §5.
  return Math.min(Math.max(daysSince + 1, 1), 4) as 1 | 2 | 3 | 4;
}

// Reuses exactly the 4 green tones already established elsewhere in the app
// (green-600/green-700 — RelationshipSummaryCard's own "warm" dot and the
// "invested" StatusPill; green-50/green-100 — SupportTicketsPanel/
// CompanyFactsPanel badges) — no new gradient/tone invented, per the
// prompt's own instruction. Text flips to a light green at tiers 3-4 for
// contrast on the now-solid background, matching how StatusPill already
// pairs 'invested' (bg-green-700) with white text.
const ESCALATION_TIER_CLASS: Record<1 | 2 | 3 | 4, { card: string; tag: string }> = {
  1: { card: 'border-green-100 bg-green-50 hover:border-green-100', tag: 'text-gray-500' },
  2: { card: 'border-green-100 bg-green-100 hover:border-green-100', tag: 'text-gray-500' },
  3: { card: 'border-green-600 bg-green-600 hover:border-green-600', tag: 'text-green-100' },
  4: { card: 'border-green-700 bg-green-700 hover:border-green-700', tag: 'text-green-100' },
};

// Wave/Status/Sectors are all multi-select and combinable (AND across the
// three, OR within each one's selected values) — <details>/<summary> gives a
// keyboard-accessible dropdown with no extra open/close state, matching the
// <details> pattern already used elsewhere in the app (e.g. PacksPanel).
function MultiSelectFilter({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
  return (
    <details className="relative">
      <summary className="cursor-pointer select-none list-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700 marker:content-none">
        {label}{selected.length > 0 && <span className="ml-1 text-[#0E7490]">({selected.length})</span>}
      </summary>
      <div className="absolute z-10 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
        {options.length === 0 && <p className="px-1.5 py-1 text-xs text-gray-400">No options.</p>}
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-gray-400 hover:underline">Clear</button>
        )}
      </div>
    </details>
  );
}

// P104 #6 — the copy always described two paths (catalog assignment or
// manual import), but nothing ever called unlockPack() from any UI —
// confirmed by exhaustive grep, 0 rows in pack_unlocks for any real org.
// Self-service, confirmed with Nuno: once profile completeness crosses this
// threshold, a button appears and the founder triggers unlockPack()
// themselves — unlockPack() itself is untouched, already correct.
const SELF_SERVICE_COMPLETENESS_THRESHOLD = 70;
// Matched by name, not id — packs have no stable machine key (no `kind`
// column like folders do); acceptable here since this only ever unlocks a
// curated catalog pack, not a security-relevant lookup like Prompt 103's
// Data Room folder fix. Fails safe (button just doesn't render) if renamed.
const STARTER_PACK_NAME = 'Starter Europe';

// pipeline.empty (onboarding_sherlockdeal_v2.md §3, §1.1) — deliberately
// NOT part of the onboarding engine: no persistence, no dismiss button,
// no `seen` key. It's computed live from db.entities every render and
// disappears the instant it stops being true. `screen` replaces the whole
// page when there are zero entities at all; `banner` sits above the table
// when entities exist but none are wave-classified yet — same copy, same
// key, different container per the implementation note in §3.
function EmptyCompanyBlock({ variant }: { variant: 'screen' | 'banner' }) {
  const { db, unlockPack } = useStore();
  const [unlocking, setUnlocking] = useState(false);
  const [result, setResult] = useState<'added' | 'none' | null>(null);
  // Prompt 156 — the match runs off the profile data as it stands the
  // instant unlockPack() fires, and (per the plan's monthly cadence) can't
  // be re-run on demand afterward — so this button used to go straight
  // from "eligible" to "unlocked" with nothing in between confirming the
  // founder actually meant to lock that data in now. `confirming` is a
  // pure UI gate in front of the same unlockPack() call below — no new
  // state, no new endpoint, matches this prompt's own "UI only" scope.
  const [confirming, setConfirming] = useState(false);

  const { pct } = calcCompanyCompleteness(db.org, db.companyPeople);
  const starterPack = db.packs.find((p) => p.name === STARTER_PACK_NAME);
  const eligible = pct >= SELF_SERVICE_COMPLETENESS_THRESHOLD && !!starterPack;

  async function unlock() {
    if (!starterPack) return;
    setUnlocking(true);
    const added = await unlockPack(starterPack.id);
    setUnlocking(false);
    setConfirming(false);
    setResult(added > 0 ? 'added' : 'none');
  }

  return (
    <div className={variant === 'screen' ? 'flex min-h-[50vh] items-center justify-center' : 'rounded-2xl border border-gray-100 bg-white p-6 shadow-sm'}>
      <div className="mx-auto max-w-[420px] text-center">
        <div className="mx-auto mb-5 flex h-[80px] w-[80px] items-center justify-center rounded-full bg-gray-50 text-3xl">🔍</div>
        {confirming ? (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">Congratulations — we have enough to show you your best-matched investors</h2>
            <p className="mb-5 text-sm text-gray-500">
              Confirm your company profile is accurate before you unlock — the match uses this data as it stands right now.
              If something&apos;s wrong, fix it first: you won&apos;t get a fresh match until your plan&apos;s monthly renewal.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button disabled={unlocking} onClick={unlock}
                className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
                {unlocking ? 'Unlocking…' : 'Confirm and unlock my pipeline'}
              </button>
              <button disabled={unlocking} onClick={() => setConfirming(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Let me check my profile first
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">No investors in the pipeline yet</h2>
            <p className="mb-5 text-sm text-gray-500">
              {eligible
                ? 'Your profile is complete enough to unlock your first batch of catalog investors, or you can import your own contacts.'
                : `As soon as your profile is at least ${SELF_SERVICE_COMPLETENESS_THRESHOLD}% complete you can unlock investors from the catalog yourself, or you can import your own contacts now.`}
            </p>
            {result === 'added' && <p className="mb-3 text-sm font-medium text-emerald-700">Done — check the table below.</p>}
            {result === 'none' && <p className="mb-3 text-sm text-gray-500">No new investors left in this pack for your account.</p>}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {eligible && (
                <button onClick={() => setConfirming(true)}
                  className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
                  Unlock my pipeline
                </button>
              )}
              <Link href="/settings" className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {eligible ? 'Import contacts instead' : 'Complete your profile'}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Prompt 123 §B.3 acceptance — a visible number that moves as the founder
// completes their profile / uploads documents / logs milestones, not just
// static card copy. `null` (still loading, or the route failed) renders
// nothing rather than a misleading "0".
function PipelineUnlockBadge({ unlock }: { unlock: { gateComplete: boolean } | null }) {
  if (!unlock) return null;
  if (!unlock.gateComplete) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Pipeline locked — complete your company profile (website, sector, stage, country, round target, current phase, founding year, revenue, and a primary contact) to start unlocking investors.
      </div>
    );
  }
  // Prompt 260 §1 — the "N of M eligible investors unlocked" sentence is
  // gone; gateComplete no longer has anything left to say here (Active/
  // Frozen counts on the stats row below cover the "how many do I have"
  // question instead). Nothing renders rather than an empty styled div
  // taking up layout space.
  return null;
}

// Prompt 271 §3 / Prompt 272 — the inline verdict line for a "Ask Sherlock"
// result. 'reactivate' points at the full proposal (advice, "Draft this
// message") now sitting in ReawakeningQueue rather than repeating it here;
// 'hold_for_hook' names the concrete thing to go create first (never
// silence); 'not_worth_it' is the plain reason. Never reactivate on its
// own text — the queue is the single place a ready-to-draft reactivation
// is ever acted on.
function NeglectResultLine({ result }: { result: { outcome: NeglectOutcome; rationale: string; newHook?: string; holdReason?: string } }) {
  if (result.outcome === 'reactivate') {
    return <p className="mt-0.5 text-[11px] font-medium text-[#0f5132]">→ Sherlock proposed a reactivation — see the queue above.</p>;
  }
  if (result.outcome === 'hold_for_hook') {
    return <p className="mt-0.5 text-[11px] text-amber-700">Sherlock: not yet — {result.holdReason ?? result.rationale}</p>;
  }
  return <p className="mt-0.5 text-[11px] text-gray-500">Sherlock: not worth it — {result.rationale}</p>;
}

// Prompt 257 §1/§2 — the founder's own default read of the list, three
// fixed bands, computed BEFORE any per-column sort: (1) any live
// relationship — diligence, a fresh/unactioned expressed-interest decision,
// an active Sherlock thread, or recent back-and-forth (relationshipSummary's
// own health, already the app's one recency-aware "still warm" signal —
// naturally excludes an entity that WAS in conversation months ago and has
// gone quiet since); (2) no relationship yet but a fit signal — reuses
// fit_score exactly as already computed at catalog-delivery time (nothing
// new invented, per the prompt's own "levantar antes, não inventar"); (3)
// everyone else, including brand-new/never-scored entities. A frozen entity
// never lands in band 1/2 regardless of a stale fit_score — being parked IS
// the "not live" signal, independent of what its fit once was.
function pipelineBand(db: Db, e: Entity, interestedEntityIds: Set<string>, activeThreadEntityIds: Set<string>): 1 | 2 | 3 {
  if (e.status === 'dormant') return 3;
  if (e.status === 'diligence') return 1;
  if (interestedEntityIds.has(e.id) || activeThreadEntityIds.has(e.id)) return 1;
  const health = relationshipSummary(db, e.id).health;
  if (health === 'hot' || health === 'warm') return 1;
  if (e.fit_score && e.fit_score !== 'low') return 2;
  return 3;
}

function sortValue(db: Db, key: SortKey, e: Entity): unknown {
  switch (key) {
    case 'name': return e.name;
    case 'type': return e.type;
    case 'hq': return `${e.hq_country ?? ''} ${e.hq_city ?? ''}`.trim() || null;
    case 'check': return e.check_min_eur ?? null;
    case 'sectors': return e.sectors.join(', ') || null;
    case 'fit': return e.fit_score ? fitOrder[e.fit_score] : null;
    case 'wave': return e.wave ?? null;
    case 'status': return e.status;
    case 'next_action': return nextAction(db, e)?.due_at ?? null;
  }
}

export default function PipelinePage() {
  useTrackPageView('/pipeline');
  const { db, loading, markEntityVerified, askSherlock } = useStore();
  // Prompt 271 §3 / Prompt 272 — per-entity Sherlock evaluation state for
  // the "Stand by" view. 'loading' while the request is in flight; a
  // verdict object once it resolves (shown inline — 'hold_for_hook' and
  // 'not_worth_it' are recorded in reawakening_proposals but never
  // surfaced by ReawakeningQueue, so this is the ONLY place the founder
  // ever sees that reasoning). Absent from the map = idle, still showing
  // the "Ask Sherlock" button.
  const [neglectResults, setNeglectResults] = useState<Record<string, 'loading' | { outcome: NeglectOutcome; rationale: string; newHook?: string; holdReason?: string }>>({});
  const [q, setQ] = useState('');
  const [wave, setWave] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [country, setCountry] = useState('');
  // Prompt 257 §4 — "See frozen" toggle, off (default) by exclusion.
  // Prompt 277 B split this into five dedicated views (Frozen/Stale/Stand
  // by/Not applicable/Reported); Prompt 282 collapsed that back to THREE,
  // by Nuno's own explicit decision after seeing the 5-button header in
  // production ("são demasiados"). The classifier itself
  // (classifyEntityFrozenState, frozen-classifier.ts) is completely
  // untouched — only how its six values get GROUPED into views changes,
  // and that grouping now lives in ONE place (frozen-view-grouping.ts's
  // viewForFrozenState/pillLabelForFrozenState), not duplicated across the
  // row filter/counts/pill label the way it was when 282 shipped — the
  // direct cause of needing a second correction one prompt later (283).
  //
  // Prompt 283 — Nuno found a real case: Sofinnova MD Start (a legitimate,
  // relevant investor — €4B+ AUM group, Capital Strategy leads biopharma/
  // medtech deals — whose hard_filter is specifically "model mismatch" on
  // the accelerator arm) was showing under 🚨 Reported. His principle:
  // entering Reported requires EVIDENCE (the fraud-report flow with
  // justification + proof, 277 A) — "doesn't fit" is not an accusation and
  // must never share the 🚨 with it. So the mapping is now:
  //   'frozen' = closed_for_cause + frozen_cold + not_a_fit — a "not a fit"
  //     IS an impasse under Nuno's own Frozen definition ("won't move
  //     without a change in conditions"): Bynd (reaffirmed anti-medtech
  //     policy), Pathena (wind-down), Sofinnova MD Start (accelerator
  //     model) all fit that description, none of them fraud.
  //   'stale' = stand_by + no_data, unchanged from 282.
  //   'reported' = ONLY blocked (fraud reported with proof) — with 0 real
  //     cases today, the button hides entirely rather than sitting at 🚨(0)
  //     as permanent noise (see the button rendering below).
  // Three mutually-exclusive views plus 'none', still session-local.
  const [frozenView, setFrozenView] = useState<'none' | 'frozen' | 'stale' | 'reported'>('none');
  const [sortKey, setSortKey] = useState<SortKey>('wave');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [addInvestorOpen, setAddInvestorOpen] = useState(false);
  // Prompt 261 — dismiss the stats+spotlight card for this visit only.
  // Plain component state, nothing persisted: PipelinePage unmounts on
  // route change (confirmed live — navigating to /tasks and back re-runs
  // this component from scratch), so leaving to another page and coming
  // back already resets it with no extra logic needed. statsExiting drives
  // the CSS exit animation; statsDismissed removes the card from the DOM
  // once that animation (or, for prefers-reduced-motion, no animation at
  // all) has had time to finish.
  const [statsExiting, setStatsExiting] = useState(false);
  const [statsDismissed, setStatsDismissed] = useState(false);
  function dismissStatsCard() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setStatsDismissed(true); return; }
    setStatsExiting(true);
    setTimeout(() => setStatsDismissed(true), 220);
  }
  // Prompt 107 B.5 — which delivered entities are currently a suspended
  // investor. Derived at read time, never a mass write to `entities` (see
  // /api/pipeline/suspended-investors's own header for why).
  const [suspendedEntityIds, setSuspendedEntityIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/pipeline/suspended-investors', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => { if (b.ok) setSuspendedEntityIds(new Set(b.suspendedEntityIds)); }).catch(() => {});
  }, []);
  // Prompt 257 §2 — the two "live relationship" signals that aren't already
  // sitting on db.entities (see entity-catalog-prefill.ts-style research:
  // interested decisions and Sherlock threads are org-level tables with no
  // stored link to entities.id — resolved server-side via catalog_deliveries,
  // same join every other founder route already uses). Fetched once on
  // mount, not per-render; empty sets in demo mode (both routes no-op
  // cleanly when !authEnabled, matching every other fetch on this page).
  const [interestedEntityIds, setInterestedEntityIds] = useState<Set<string>>(new Set());
  const [activeThreadEntityIds, setActiveThreadEntityIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/founder/investor-interest?all=1', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => setInterestedEntityIds(new Set((b.items ?? []).map((i: { entityId: string | null }) => i.entityId).filter(Boolean))))
      .catch(() => {});
    fetch('/api/founder/messages', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => setActiveThreadEntityIds(new Set((b.threads ?? []).map((t: { entityId: string | null }) => t.entityId).filter(Boolean))))
      .catch(() => {});
  }, []);
  // Prompt 292 §Fase 1 (Pedido 6) — same batched-once-on-mount pattern as
  // the two fetches above; keyed by entityId -> its most recent recorded
  // investment (the route already orders by invested_at desc), since a
  // row only has room for one badge regardless of how many are on file.
  const [competitorInvestmentByEntityId, setCompetitorInvestmentByEntityId] = useState<Map<string, CompetitorInvestmentItem>>(new Map());
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/founder/competitor-investments', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => {
        const map = new Map<string, CompetitorInvestmentItem>();
        for (const item of (b.items ?? []) as CompetitorInvestmentItem[]) {
          if (item.entityId && !map.has(item.entityId)) map.set(item.entityId, item);
        }
        setCompetitorInvestmentByEntityId(map);
      }).catch(() => {});
  }, []);
  // Prompt 320 — Pathfinder's own discreet row indicator: which entities
  // have at least one connection with a verified invested relationship.
  // One batched query for the whole table (getPathfinderEntityIdsWithMatch),
  // same pattern as the two fetches above — never a per-row request.
  const [pathfinderEntityIds, setPathfinderEntityIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/network/pathfinder?summary=1', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => { if (b.ok) setPathfinderEntityIds(new Set(b.entityIds)); }).catch(() => {});
  }, []);
  // How many catalog-sourced investors are blocked by the plan's accumulated
  // quota — a COUNT only, via the catalog_blocked_count() RPC (migration
  // 0042). Blocked rows themselves never reach this client at all: the
  // entities RLS SELECT policy already excludes them from every
  // `sb.from('entities')` read (including the one useStore's initial load
  // does), so there is nothing to filter here — this is purely "how many
  // more are there" for the frosted-glass message below.
  const [blockedCount, setBlockedCount] = useState(0);
  // Prompt 123 Block B.2 — the pipeline-unlock engine's live number (base
  // by plan + profile/upload/milestone bonuses + monthly growth). Re-checked
  // whenever entities change so it visibly moves right after a founder
  // completes their profile or uploads a deck, per the block's own
  // acceptance criterion.
  // Prompt 260 §1 — visible/eligiblePoolSize dropped from this local type:
  // they only ever fed PipelineUnlockBadge's now-removed "N of M unlocked"
  // sentence. gateComplete (the badge) and catalogQuotaTarget (the blocked-
  // panel copy below) are the only fields this page still reads.
  const [unlock, setUnlock] = useState<{ gateComplete: boolean; catalogQuotaTarget: number } | null>(null);
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/pipeline-unlock', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => { if (b.ok) setUnlock({ gateComplete: b.gateComplete, catalogQuotaTarget: b.catalogQuotaTarget ?? 0 }); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.entities.length]);
  const { setCondition } = useOnboarding();

  // waves coach mark (§3): fires the first time the pipeline shows
  // investors already classified by wave.
  useEffect(() => {
    setCondition('waves', db.entities.some((e) => e.wave != null));
  }, [db.entities, setCondition]);

  useEffect(() => {
    if (!authEnabled || !db.org.id) return;
    browserClient().rpc('catalog_blocked_count', { check_org: db.org.id })
      .then(({ data, error }) => setBlockedCount(!error && typeof data === 'number' ? data : 0));
    // Re-checked whenever the entity count changes (unlock, manual add,
    // import) — an upgrade/repriorization/new catalog delivery should make
    // the frosted-glass count shrink without needing a page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.org.id, db.entities.length]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? 'null');
      // The removed 'ready' key may still be sitting in an old visitor's
      // localStorage — ignore it and fall back to the default rather than
      // sorting by a column that no longer exists.
      if (saved?.key && (SORT_KEYS as string[]).includes(saved.key)) {
        setSortKey(saved.key); setSortDir(saved.dir === 'desc' ? 'desc' : 'asc');
      }
    } catch { /* ignore malformed storage */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
  }, [sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  // Prompt 271 §1/§2 / Prompt 273 §3 / Prompt 277 A / Prompt 283 — one map,
  // one classification call per relevant entity, via the ALREADY-existing
  // classifyEntityFrozenState (frozen-classifier.ts), which itself checks
  // hard_filter_status before falling through to classifyFrozen — both
  // hard-filter values take precedence over everything, including status
  // (an entity can reach either before ever going dormant). This replaces
  // three separate hand-rolled Sets/Map (notApplicableIds/reportedIds/
  // frozenClasses) that 282 introduced and had to keep in sync by hand
  // across the row filter, counts, and pill label — exactly the kind of
  // duplication that let 282's own mapping mistake happen. An entity is
  // included here once it's either dormant OR carries a resolved hard-
  // filter value; anything else has no frozen-view membership at all.
  const entityFrozenStates = useMemo(() => {
    const m = new Map<string, EntityFrozenState>();
    for (const e of db.entities) {
      if (e.status !== 'dormant' && e.hard_filter_status !== 'resolved_not_a_fit' && e.hard_filter_status !== 'resolved_blocked') continue;
      m.set(e.id, classifyEntityFrozenState(e, db.interactions.filter((i) => i.entity_id === e.id)));
    }
    return m;
  }, [db]);

  const rows = useMemo(() => {
    let list = [...db.entities];
    // Prompt 257 §4 — the toggle's own base filter, applied before anything
    // else: 'none' means frozen entities are never in `list` to begin with
    // (not just dimmed); any other value flips it to show nothing BUT that
    // class, same filters/sort/layout still apply on top.
    // Prompt 283 — the class -> view mapping itself lives in
    // viewForFrozenState (frozen-view-grouping.ts) now, not inline here.
    list = list.filter((e) => {
      const state = entityFrozenStates.get(e.id);
      // No state = neither dormant nor hard-filtered: shows only in 'none'.
      // A classified state is excluded from 'none' entirely (never just
      // dimmed) and shown only in the one view it maps to.
      if (!state) return frozenView === 'none';
      return frozenView !== 'none' && viewForFrozenState(state) === frozenView;
    });
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())
      || e.sectors.some((s) => s.toLowerCase().includes(q.toLowerCase())));
    if (wave.length) list = list.filter((e) => wave.includes(String(e.wave)));
    if (status.length) list = list.filter((e) => status.includes(e.status));
    if (sectors.length) list = list.filter((e) => e.sectors.some((s) => sectors.includes(s)));
    if (country) list = list.filter((e) => e.hq_country === country);
    const dir = sortDir === 'asc' ? 1 : -1;
    // Prompt 257 §1 — bands are the founder's default read of the list, not
    // a standing constraint: the moment they pick any other column/direction
    // (toggleSort), that choice wins outright and the list goes back to a
    // flat sort exactly as before this prompt. Reusing sortKey/sortDir as
    // the single "has this been overridden" signal needs no new state.
    const bandingActive = sortKey === 'wave' && sortDir === 'asc';
    list.sort((a, b) => {
      if (bandingActive) {
        const bandDiff = pipelineBand(db, a, interestedEntityIds, activeThreadEntityIds)
          - pipelineBand(db, b, interestedEntityIds, activeThreadEntityIds);
        if (bandDiff !== 0) return bandDiff;
      }
      return cmp(sortValue(db, sortKey, a), sortValue(db, sortKey, b)) * dir
        || (a.wave ?? 9) - (b.wave ?? 9) || (fitOrder[a.fit_score ?? 'low'] - fitOrder[b.fit_score ?? 'low']);
    });
    return list;
  }, [db, q, wave, status, sectors, country, sortKey, sortDir, interestedEntityIds, activeThreadEntityIds, frozenView, entityFrozenStates]);

  const countries = Array.from(new Set(db.entities.map((e) => e.hq_country).filter(Boolean))) as string[];
  const sectorOptions = Array.from(new Set(db.entities.flatMap((e) => e.sectors))).sort();
  // Prompt 282/283 — three counts, matching the three buttons, all derived
  // from the one grouping function so they can never drift from the row
  // filter or the pill label above.
  const viewCounts = { frozen: 0, stale: 0, reported: 0 };
  for (const state of entityFrozenStates.values()) viewCounts[viewForFrozenState(state)]++;
  const frozenCount = viewCounts.frozen;
  const staleCount = viewCounts.stale;
  // Named reportedCount, not blockedCount — that name is already taken by
  // the unrelated catalog-quota "blocked" count further up (from the
  // catalog_blocked_count() RPC, Prompt 123).
  const reportedCount = viewCounts.reported;
  const notActivePipelineCount = frozenCount + staleCount + reportedCount;

  // Prompt 273 §3 / Prompt 282/283 — the row's Status pill shows the real
  // sub-class, not the raw 'dormant' status, but only inside the 3
  // dedicated views (frozenView !== 'none') — the normal pipeline view
  // keeps StatusPill's plain default. Collapsing 5 header buttons to 3
  // (282) didn't lose any granularity — it only moved it from the header
  // into this per-row pill (pillLabelForFrozenState).
  function frozenPillLabel(e: Entity): string | undefined {
    if (frozenView === 'none') return undefined;
    const state = entityFrozenStates.get(e.id);
    return state ? pillLabelForFrozenState(state) : undefined;
  }
  const personCandidates = db.entities.filter((e) => isPersonCandidate(db, e));
  const noEntities = db.entities.length === 0;
  const noneClassified = !noEntities && db.entities.every((e) => e.wave == null);

  // Prompt 271 §3 — on-demand only, never automatic: askSherlock is only
  // ever called from these two explicit click handlers.
  async function askSherlockFor(entityIds: string[]) {
    setNeglectResults((prev) => {
      const next = { ...prev };
      for (const id of entityIds) next[id] = 'loading';
      return next;
    });
    const results = await askSherlock(entityIds);
    setNeglectResults((prev) => {
      const next = { ...prev };
      for (const id of entityIds) {
        const r = results.find((x) => x.entityId === id);
        // A missing result (already-pending ask, or server-side reclassified
        // as not actually dropped_by_us) reverts to idle rather than
        // getting stuck on "loading" forever — the button just reappears.
        if (r) next[id] = { outcome: r.outcome, rationale: r.rationale, newHook: r.newHook, holdReason: r.holdReason };
        else delete next[id];
      }
      return next;
    });
  }

  // Top-of-page summary — counts + up to 6 most-recently-updated relationships.
  // "In talks" is in_conversation's display label here specifically (matches
  // the landing page's own wording for this summary); the raw status value
  // and its label everywhere else in the app (StatusPill etc.) are untouched.
  const contactedCount = db.entities.filter((e) => e.status === 'contacted').length;
  const inTalksCount = db.entities.filter((e) => e.status === 'in_conversation').length;
  const diligenceCount = db.entities.filter((e) => e.status === 'diligence').length;
  const updateCards = db.entities
    .map((e) => {
      const latest = db.interactions.filter((i) => i.entity_id === e.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
      return { entity: e, tag: lastUpdateTag(db, e), latest, escalationTier: pendingRequestEscalationTier(e, latest, new Date()) };
    })
    .filter((r) => r.tag)
    .sort((a, b) => (b.latest?.occurred_at ?? '').localeCompare(a.latest?.occurred_at ?? ''))
    .slice(0, 6);

  // Prompt 126 F — the real bug this fixes: db.entities starts empty until
  // the store's initial load resolves, and `noEntities` couldn't tell that
  // apart from a genuinely empty org — a ~100-entity org briefly rendered
  // "No investors in the pipeline yet" on every real-mode page load. Checked
  // BEFORE noEntities, never instead of it: an org that's actually empty
  // once loading finishes still gets the real empty state below.
  if (loading) {
    return <LoadingState label="Loading your pipeline…" />;
  }

  if (noEntities) {
    return (
      <div className="space-y-4">
        <MatchDealVisibilityBanner />
        <PipelineUnlockBadge unlock={unlock} />
        <EmptyCompanyBlock variant="screen" />
      </div>
    );
  }

  return (
    // Prompt 257 §5 — "two elevators" (the whole page, and the list's own
    // 15-row scroll). Fix is scoped to md+ only (desktop is this table's
    // real use case — 760 rows on a phone is already a stretch, and mobile
    // pixel math for a sticky/bounded chrome is a different, riskier
    // problem not asked for here): the root becomes a flex column bounded
    // to the viewport height minus WorkspaceHeader (53px, measured live in
    // the browser, same "measured, not guessed" discipline as
    // PIPELINE_LIST_MAX_HEIGHT_PX below) minus <main>'s own top+bottom
    // padding (32px+32px at md+, p-8). Every child keeps its natural size
    // (shrink-0) EXCEPT the list, which becomes flex-1 and absorbs
    // whatever space is left — in the common case (short/no banners) that's
    // most of the viewport, and the list's own overflow-y-auto is the only
    // scrollbar that ever activates. The root itself keeps overflow-y-auto
    // too (not hidden) as a graceful fallback if an unusual banner stack
    // ever exceeds the bounded height, rather than clipping content.
    <div className="space-y-4 md:flex md:h-[calc(100vh-117px)] md:flex-col md:space-y-0 md:gap-4 md:overflow-y-auto">
      {/* P131-A — the banner already existed (Dashboard only, addenda to
          Prompt 120); the founder-facing gap was that Pipeline — the page
          this whole "why can't investors see us" mystery is actually about —
          never had it. Same component, same /api/company/visibility source,
          no new logic. */}
      <div className="md:shrink-0"><MatchDealVisibilityBanner /></div>
      <PageTour pageKey="guide_pipeline" />
      <div className="md:shrink-0"><PipelineUnlockBadge unlock={unlock} /></div>
      {noneClassified && <div className="md:shrink-0"><EmptyCompanyBlock variant="banner" /></div>}
      {!statsDismissed && (
      <div className={`relative md:shrink-0 ${statsExiting ? 'pipeline-stats-card-exit' : ''}`}>
        {/* Prompt 261 — half on, half off the rounded-2xl corner, like a
            badge sitting on the edge, not a button inside the content
            padding. Neutral palette (gray-500/border-gray-300, hover
            gray-700/gray-50) — no new color. */}
        <button onClick={dismissStatsCard} aria-label="Dismiss this card for now" title="Dismiss for this visit"
          className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-700">
          ×
        </button>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Contacted</span>
            <span className="text-lg font-bold text-gray-800">{contactedCount}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">In talks</span>
            <span className="text-lg font-bold text-[#0E7490]">{inTalksCount}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Diligence</span>
            <span className="text-lg font-bold text-amber-600">{diligenceCount}</span>
          </div>
          {/* Prompt 260 §2 — Active/Frozen, pushed to the right on the same
              row (ml-auto, same pattern as the "See frozen" toggle further
              down). Neutral colors on purpose: this is context ("how many
              do I have"), not a metric to celebrate like the three above.
              Prompt 273/277/282 — every dedicated view's entities subtracted
              out, same as they're excluded from the row filter's 'none'
              view: none of them are "active" just because they no longer
              count as plain frozen. "Frozen" stays the umbrella label for
              this one summary number on purpose — the 3-way breakdown
              (Frozen/Stale/Reported) is what the toggle buttons below are
              for; this top line only needs "how many am I not actively
              pursuing right now". */}
          <div className="ml-auto flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Active</span>
            <span className="text-lg font-bold text-gray-800">{db.entities.length - notActivePipelineCount}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Frozen</span>
            <span className="text-lg font-bold text-gray-500">{notActivePipelineCount}</span>
          </div>
        </div>
        {updateCards.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
            {updateCards.map(({ entity, tag, escalationTier }) => {
              const tier = escalationTier ? ESCALATION_TIER_CLASS[escalationTier] : null;
              return (
                <Link key={entity.id} href={`/entities/${entity.id}`}
                  title={escalationTier ? `Awaiting your reply — day ${escalationTier} of the spotlight` : undefined}
                  className={`rounded-xl border px-3 py-2 transition ${tier ? tier.card : 'border-gray-100 bg-gray-50 hover:border-[#0E7490] hover:bg-[#E8F4F8]'}`}>
                  <div className={`truncate text-sm font-medium ${escalationTier && escalationTier >= 3 ? 'text-white' : 'text-gray-800'}`}>{entity.name}</div>
                  <div className={`mt-0.5 truncate text-xs ${tier ? tier.tag : 'text-gray-500'}`}>{tag}</div>
                </Link>
              );
            })}
          </div>
        )}
        </div>
      </div>
      )}

      <div className="md:shrink-0"><ReawakeningQueue /></div>
      {personCandidates.length > 0 && (
        <div className="md:shrink-0 rounded-2xl border-l-4 border-purple-400 bg-purple-50 p-4">
          <div className="text-sm font-semibold text-purple-900">
            Needs verification — looks like a person, not a fund ({personCandidates.length})
          </div>
          <ul className="mt-2 space-y-2 text-sm">
            {personCandidates.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
                <Link href={`/entities/${e.id}`} className="font-medium text-gray-900 hover:text-[#0E7490]">{e.name}</Link>
                <span className="text-xs text-gray-400">{e.type.replace('_', ' ')} · no website · no email domain · no contacts on file</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => markEntityVerified(e.id)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">Not a person</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 md:shrink-0">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or sector…"
          className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <MultiSelectFilter label="Wave" selected={wave} onChange={setWave}
          options={[1, 2, 3].map((w) => ({ value: String(w), label: `Wave ${w}` }))} />
        <div data-tour-id="pipeline-filters">
          {/* Prompt 257 §4 — 'dormant' dropped from this list: the dedicated
              "See frozen" toggle below now owns that dimension exclusively,
              so there's exactly one way to ask for frozen entities, not two
              that could disagree. */}
          <MultiSelectFilter label="Status" selected={status} onChange={setStatus}
            options={['not_contacted', 'contacted', 'in_conversation', 'diligence', 'passed', 'invested']
              .map((s) => ({ value: s, label: statusLabel[s as keyof typeof statusLabel] }))} />
        </div>
        <MultiSelectFilter label="Sectors" selected={sectors} onChange={setSectors}
          options={sectorOptions.map((s) => ({ value: s, label: s }))} />
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(q || wave.length > 0 || status.length > 0 || sectors.length > 0 || country) && (
          <button onClick={() => { setQ(''); setWave([]); setStatus([]); setSectors([]); setCountry(''); }} className="text-sm text-gray-500 hover:underline">Clear</button>
        )}
        {/* Prompt 257 §4 — pure visualization, no actions of its own: to
            unfreeze, open the dossier and use reactivation/reopen, already
            there. 'none' by default (frozen entities excluded from the list
            entirely, not just dimmed); each button shows ONLY that class,
            same layout — never a mixed state.
            Prompt 282 — back down to THREE buttons (Nuno's own call after
            seeing the 5-button header live: "são demasiados"). Each
            button's title is Nuno's own one-line definition, verbatim, so
            the meaning can't drift again — see the frozenView state
            comment above for the full class -> view mapping and reasoning.
            Reactivation is governed by what already exists either way
            (251's code matrix / reopen doctrine); Reported still has no
            founder-side action of its own — only platform review resolves
            it, same as before. Sub-class granularity isn't lost, just moved
            off the header and onto the row's own Status pill
            (frozenPillLabel above).
            Prompt 283 — Reported hides entirely at (0), rather than sitting
            as a permanent 🚨 with nothing behind it: with only `blocked`
            counting now (evidence required), 0 is the common case, not the
            exception. Kept visible while it's the ACTIVE view even at 0, so
            toggling it back off never needs a second, different control. */}
        <button onClick={() => setFrozenView((v) => v === 'frozen' ? 'none' : 'frozen')}
          title="Chegaram a um impasse — não evoluirão sem alteração das condições."
          className={`ml-auto rounded-lg border px-2.5 py-1.5 text-sm font-medium ${frozenView === 'frozen' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {frozenView === 'frozen' ? '❄ Showing frozen' : `❄ Frozen (${frozenCount})`}
        </button>
        <button onClick={() => setFrozenView((v) => v === 'stale' ? 'none' : 'stale')}
          title="Por alguma coisa caíram no esquecimento."
          className={`rounded-lg border px-2.5 py-1.5 text-sm font-medium ${frozenView === 'stale' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {frozenView === 'stale' ? '💤 Showing stale' : `💤 Stale (${staleCount})`}
        </button>
        {(reportedCount > 0 || frozenView === 'reported') && (
          <button onClick={() => setFrozenView((v) => v === 'reported' ? 'none' : 'reported')}
            title="Não são investidores — requer prova (denúncia de fraude com justificação)."
            className={`rounded-lg border px-2.5 py-1.5 text-sm font-medium ${frozenView === 'reported' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {frozenView === 'reported' ? '🚨 Showing reported' : `🚨 Reported (${reportedCount})`}
          </button>
        )}
        {/* Prompt 271 §3 / Prompt 282 — bulk ask moved to the Stale view
            (Stand by no longer has its own button), but still only ever
            acts on the stand_by rows WITHIN it, never the no_data ones now
            sharing the view — the server-side re-verification itself is
            unchanged. */}
        {frozenView === 'stale' && rows.some((e) => entityFrozenStates.get(e.id) === 'stand_by' && !neglectResults[e.id]) && (
          <button onClick={() => askSherlockFor(rows.filter((e) => entityFrozenStates.get(e.id) === 'stand_by' && !neglectResults[e.id]).map((e) => e.id))}
            className="rounded-lg bg-[#0f5132] px-2.5 py-1.5 text-sm font-medium text-white hover:bg-[#0c4028]">
            Ask Sherlock — evaluate all ({rows.filter((e) => entityFrozenStates.get(e.id) === 'stand_by' && !neglectResults[e.id]).length})
          </button>
        )}
        <button data-tour-id="pipeline-import" onClick={() => setAddInvestorOpen(true)} className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-[#0E7490] hover:bg-[#E8F4F8]">+ Add investor</button>
      </div>

      {/* Prompt 342 — Pipeline reigns alone again: the two-column layout
          Prompt 330 §C added here (table + "Partners & colleagues" panel)
          is reverted per Nuno's own correction — that panel never belonged
          on the Pipeline (the DRIVE menu, a full-width investor table), and
          moved to My Network > Connections instead (see
          network/page.tsx's own "My connections" card). This is back to
          exactly the pre-330 layout: the table div below carries its own
          md:flex-1/md:min-h-0 directly against this root flex column
          (Prompt 257 §5), no wrapping row/column needed since there's only
          ever one column here now. */}
      {/* Prompt 188 §1 — own vertical scroll capped at ~15 rows so the
          list doesn't grow the whole page; max-height (not a hard height)
          so a short pipeline still shrinks to fit instead of leaving dead
          white space below it — "altura fixa" read literally would do
          that for every org with fewer than 15 unlocked investors, which
          is most of them today, so this reads the requirement as "cap at
          15, don't force it" rather than the literal words. */}
      {/* Prompt 192 — corrects 188 §2: the blocked-panel used to live
          inside THIS scroll container, after </table>, so it only became
          visible once the user scrolled the 15-row list all the way down.
          Split back into two sibling divs (blockedCount > 0 below) — this
          one keeps its own scroll and, when a panel follows, only rounds
          its TOP corners and drops its bottom border so the two read as
          one continuous shape with no seam. */}
      {/* Prompt 257 §5 — at md+ this is the ONE scrollbar the root's own
          bounded flex column exists for: flex-1 + min-h-0 lets it absorb
          whatever height the (shrink-0) banners/filters above didn't use,
          overriding the fixed maxHeight below. Below md, the root isn't
          flex-bound (mobile keeps ordinary page scroll, see the root div's
          own comment), so the original fixed cap still applies there. */}
      {/* max-h-[888px] must match PIPELINE_LIST_MAX_HEIGHT_PX above — a
          literal class, not the JS constant, because Tailwind's build-time
          scanner can't see a template-interpolated arbitrary value; only
          applies below md (mobile keeps the original fixed-cap behavior),
          overridden by md:max-h-none once the flex-1 sizing takes over. */}
      <div data-tour-id="pipeline-list"
        className={`overflow-x-auto overflow-y-auto border border-gray-100 bg-white shadow-sm max-h-[888px] md:min-h-0 md:max-h-none md:flex-1 ${blockedCount > 0 ? 'rounded-t-2xl border-b-0' : 'rounded-2xl'}`}>
        {/* table-fixed + explicit column widths (colgroup) so the table
            holds to the container's width at every wave filter setting
            instead of growing with content and forcing horizontal scroll;
            cells wrap (see td classes) rather than truncate. */}
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {SORT_COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              {SORT_COLUMNS.map((c) => {
                const headerButton = (
                  <Tooltip text={`Sort by ${c.label.toLowerCase()}.`} side="bottom">
                    <button onClick={() => toggleSort(c.key)}
                      className={`flex items-center gap-1 font-medium uppercase tracking-wide hover:text-gray-700 ${sortKey === c.key ? 'text-[#0E7490]' : ''}`}>
                      {c.label} {sortKey === c.key && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </Tooltip>
                );
                return (
                  <th key={c.key} className="px-2 py-1.5">
                    {c.key === 'wave' ? <CoachMark itemKey="waves">{headerButton}</CoachMark> : headerButton}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const task = nextAction(db, e);
              const overdue = task?.due_at && new Date(task.due_at) < new Date();
              const hf = e.hard_filter_status === 'open';
              const suspended = suspendedEntityIds.has(e.id);
              // Prompt 257 §2 — the graphic identification band 1 needs: a
              // discrete chip in the existing teal palette, no new colors.
              // "★ Interested" specifically for an unactioned expressed-
              // interest decision (the Invest green case — the one that
              // should jump out fastest); "● In conversation" for every
              // other live-relationship reason (diligence, an active
              // thread, recent back-and-forth).
              const interested = interestedEntityIds.has(e.id);
              const inBand1 = pipelineBand(db, e, interestedEntityIds, activeThreadEntityIds) === 1;
              // Prompt 259 — zebra striping so the eye can track a row
              // across 760 entities. Reuses gray-50 (already the app's own
              // card/dropdown-hover tone, not a new color) at 60% opacity;
              // it's only the BASE fill — hover and the hard-filter/
              // suspended states below still win visually, since they're
              // separate classes applied alongside it, not replacing it.
              const zebra = i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white';
              return (
                <tr key={e.id}
                  className={`border-b border-gray-100 align-top hover:bg-[#E8F4F8]/60 ${zebra} ${suspended ? 'opacity-50' : ''} ${hf ? 'border-l-2 border-l-[#B00000]' : ''}`}>
                  <td className="break-words px-2 py-1.5 font-medium">
                    <Link href={`/entities/${e.id}`} className="text-gray-900 hover:text-[#0E7490]">
                      {e.name} {hf && <span title={e.hard_filter} className="text-[#B00000]">⚑</span>}
                      {pathfinderEntityIds.has(e.id) && (
                        <span title="You have a path to this investor" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
                      )}
                    </Link>
                    {inBand1 && (
                      <span className="ml-1.5 inline-block rounded-full border border-[#0E7490]/30 bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7490]"
                        title={interested ? 'Expressed interest on the platform — hasn’t been actioned yet.' : 'A live relationship — diligence, an active thread, or recent back-and-forth.'}>
                        {interested ? '★ Interested' : '● In conversation'}
                      </span>
                    )}
                    {suspended && (
                      <span className="ml-1.5 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600" title="This investor has suspended their own visibility — not accepting contact right now. Existing access is unaffected.">
                        Suspended
                      </span>
                    )}
                    {/* Prompt 73 — a mutual MatchDeal match is a materially
                        different, hotter provenance than a manual add or a
                        catalog unlock (both sides already showed direct
                        interest) — worth surfacing at a glance, not buried
                        one click away on the entity page. */}
                    {e.source === 'match_deal' && (
                      <span className="ml-1.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title="This entity came from a mutual MatchDeal match.">
                        🤝 MatchDeal
                      </span>
                    )}
                    {/* §1c(ii) prompt 42 — a stub with no proof of its own
                        existence reads as an incomplete real profile
                        (blank fields with dashes) unless flagged explicitly. */}
                    {isUnverifiedStub(e) && (
                      <span className="ml-1.5 inline-block rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="No independent proof this entity exists yet — website, domain, phone, address, or a source specific to it.">
                        not yet verified
                      </span>
                    )}
                    {/* Prompt 292 §Fase 1 (Pedido 6) — "um dos sinais mais
                        fortes que existem" per Nuno's own framing: this
                        investor has real recorded money in a company from
                        the shared library. Full detail is a tooltip, not
                        inline text, so a dense row doesn't grow further. */}
                    {competitorInvestmentByEntityId.has(e.id) && (
                      <span className="ml-1.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                        title={competitorInvestmentSummary(competitorInvestmentByEntityId.get(e.id)!)}>
                        💰 Portfolio signal
                      </span>
                    )}
                    <RelationshipCompactLine entityId={e.id} neutral={frozenView !== 'none'} />
                    {/* E2 — a previously-passed/dormant investor that carries a
                        reopen trigger has resurfaced via the reopen doctrine;
                        say WHY it's back so the row isn't just a greyed name.
                        Prompt 269 §2 — attributed as the founder's own note
                        (the tooltip), never framed as Sherlock's own reasoning. */}
                    {e.reopen_trigger && (e.status === 'dormant' || e.status === 'passed') && (
                      <div className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700">
                        <span title="Your note — what you said would justify reopening">↻</span>
                        <span className="line-clamp-2">{e.reopen_trigger}</span>
                      </div>
                    )}
                    {/* Prompt 271 §3 / Prompt 272 / Prompt 282 — only for
                        stand_by rows, now inside the shared Stale view (the
                        row filter no longer scopes the whole view to
                        stand_by alone, so this checks the class directly).
                        On-demand, individual: no evaluation happens just
                        from viewing this list. A 'reactivate' verdict
                        already created the full proposal in
                        ReawakeningQueue (advice, "Draft this message") —
                        this line just points there rather than repeating
                        the whole breakdown in a table cell; 'hold_for_hook'
                        and 'not_worth_it' never reach that queue, so this
                        IS the only place their reasoning is ever shown. */}
                    {frozenView === 'stale' && entityFrozenStates.get(e.id) === 'stand_by' && (
                      neglectResults[e.id] === 'loading' ? (
                        <p className="mt-0.5 text-[11px] text-gray-400">Asking Sherlock…</p>
                      ) : neglectResults[e.id] ? (
                        <NeglectResultLine result={neglectResults[e.id] as { outcome: NeglectOutcome; rationale: string; newHook?: string; holdReason?: string }} />
                      ) : (
                        <button onClick={() => askSherlockFor([e.id])} className="mt-0.5 text-[11px] font-semibold text-[#0f5132] hover:underline">
                          Ask Sherlock
                        </button>
                      )
                    )}
                  </td>
                  <td className="break-words px-2 py-1.5 text-gray-500">{e.type.replace('_', ' ')}</td>
                  <td className="break-words px-2 py-1.5 text-gray-500">{e.hq_city ? `${e.hq_city}, ` : ''}{e.hq_country}</td>
                  <td className="break-words px-2 py-1.5 text-gray-500">{fmtEur(e.check_min_eur)}–{fmtEur(e.check_max_eur)}</td>
                  <td className="px-2 py-1.5">
                    {e.sectors.slice(0, 2).map((s) => (
                      <span key={s} className="mb-1 mr-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{s}</span>
                    ))}
                    {e.sectors.length > 2 && <span className="text-[11px] text-gray-400">+{e.sectors.length - 2}</span>}
                  </td>
                  <td className="px-2 py-1.5"><FitTag fit={e.fit_score} /></td>
                  <td className="px-2 py-1.5"><WaveTag wave={e.wave} /></td>
                  <td className="px-2 py-1.5"><StatusPill status={e.status} labelOverride={frozenPillLabel(e)} /></td>
                  <td className="break-words px-2 py-1.5">
                    {task ? (
                      <span className="text-xs">
                        <span className="text-gray-700">{followUpTaskDisplayTitle(task)}</span>
                        {/* Prompt 269 §3 — overdue urgency is muted in the
                            frozen view for the same reason as the whose-turn
                            chip above: the frozen state is the dominant
                            signal there, not a stale due date. */}
                        {task.due_at && <span className={overdue && frozenView === 'none' ? 'ml-1 font-semibold text-[#B00000]' : 'ml-1 text-gray-400'}>
                          · {task.due_at.slice(5, 10)}
                        </span>}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Blocked-by-plan panel — Prompt 192 (corrects 188 §2, which put
          this inside the scroll container above, so it only appeared after
          scrolling to the end of the list). Now a sibling div, flush
          against the table container (no margin-top, no border-t, only
          bottom corners rounded) so it reads as one continuous block that's
          ALWAYS visible below the 15 rows regardless of the table's own
          scroll position.

          Real frosted glass, per 192 §2: LockedWave's pattern
          (investor-workspace/PipelinePanel.tsx) copied over — aria-hidden
          skeleton rows sitting behind an absolute inset-0 bg-white/55
          backdrop-blur-sm overlay, instead of just a translucent box with
          text (which produced no actual blur before, since there was
          nothing behind it to blur). The skeleton rows are pure shape —
          bars imitating this table's own columns — never real data: the
          blocked entities themselves are never fetched (still just
          blockedCount, the catalog_blocked_count RPC), so there's nothing
          real to draw and nothing real to hide.

          Prompt 179 §C, updated by 180 and 188 — two distinct messages.
          Whether an upgrade CTA makes sense depends on whether this org's
          accumulated catalog_quota has already reached the target the
          pipeline-unlock formula currently computes for it (unlock.
          catalogQuotaTarget — same base+bonuses formula as the badge
          above, uncapped; CATALOG_QUOTA/plans.ts, the old fixed 3/15/40
          constant this used to compare against, is retired — see
          plans.ts's own header): below it, catalog_quota just hasn't
          caught up to its own live target yet (the next poll of
          /api/pipeline-unlock raises it) — no reason to push an upgrade.
          At or above it (atTarget), §188 §3 replaces the old exact-count
          "N blocked" copy with a vaguer one and gates the upgrade CTA on
          db.org.plan — NOT on getInvestorPlan/INVESTOR_PLANS/
          legendary_sleuth as the prompt's text names them: that function
          doesn't exist anywhere in this codebase (confirmed by grep), and
          INVESTOR_PLANS/pro_scout/ace_spotter/legendary_sleuth is the
          unrelated taxonomy for what INVESTORS themselves buy (Pro
          Scout/Ace Spotter/The Legendary Sleuth SaaS seats — see
          plans.ts's own INVESTOR_PLANS block). This page is the
          FOUNDER's pipeline, gated by the founder's own org.plan
          (idea/garage/motherfunding — PLAN_TIERS, same tier the
          pipeline-unlock formula above already keys off), so
          'motherfunding' is this page's actual max tier. Flagging this
          as a deviation from the prompt's literal wording rather than
          inventing a new lookup or importing an unrelated one. */}
      {blockedCount > 0 && (() => {
        const target = unlock?.catalogQuotaTarget ?? 0;
        const atTarget = (db.org.catalog_quota ?? 0) >= target;
        const onMaxPlan = db.org.plan === 'motherfunding';
        return (
          <div className="relative overflow-hidden rounded-b-2xl border border-t-0 border-gray-100 bg-white shadow-sm md:shrink-0">
            <div aria-hidden className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-3 py-3">
                  {/* Prompt 304 §2 — kept in sync with SORT_COLUMNS' own widths above. */}
                  <div className="h-3 w-[27%] rounded bg-gray-100" />
                  <div className="h-3 w-[7%] rounded bg-gray-100" />
                  <div className="h-3 w-[9%] rounded bg-gray-100" />
                  <div className="h-3 w-[8%] rounded bg-gray-100" />
                  <div className="h-3 w-[18%] rounded bg-gray-100" />
                  <div className="h-3 w-[5%] rounded bg-gray-100" />
                  <div className="h-3 w-[4%] rounded bg-gray-100" />
                  <div className="h-3 w-[9%] rounded bg-gray-100" />
                </div>
              ))}
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/55 px-6 text-center backdrop-blur-sm">
              <div className="text-2xl">🔒</div>
              {atTarget ? (
                <>
                  <p className="mt-1 text-sm font-medium text-gray-700">Thousands of investors are waiting in the catalog.</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Your next monthly batch unlocks automatically{onMaxPlan ? '.' : ' — or upgrade your plan to unlock more now.'}
                  </p>
                  {!onMaxPlan && (
                    <Link href="/plans" className="mt-3 inline-block rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
                      View plans
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm font-medium text-gray-700">New matching investors are delivered automatically.</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Next batch arrives {nextMonthlyDeliveryDate(new Date().toISOString()).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.
                  </p>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {addInvestorOpen && <AddInvestorModal onClose={() => setAddInvestorOpen(false)} />}
    </div>
  );
}
