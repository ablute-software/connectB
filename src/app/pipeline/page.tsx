'use client';
// Pipeline (home) — dense sortable/filterable entity table
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { FitTag, StatusPill, Tooltip, WaveTag, fmtEur, statusLabel } from '@/components/ui';
import pipelineMobile from './pipeline-mobile.module.css';
import { LoadingState } from '@/components/workspace-shell/LoadingState';
import { MatchDealVisibilityBanner } from '@/components/dashboard/MatchDealVisibilityBanner';
import { RelationshipCompactLine } from '@/components/RelationshipSummaryCard';
import { hasAnythingToShow, readinessChips, type ReadinessBreakdown } from '@/lib/readiness-strip';
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
import { neglectAskState, type NeglectAskState, type NeglectProposalRecord } from '@/lib/neglect-history';
import { competitorInvestmentSummary, type CompetitorInvestmentItem } from '@/lib/competitor-investment-copy';
import type { Db, Entity, Interaction, TaskItem } from '@/lib/types';

const fitOrder = { high: 0, medium_high: 1, medium: 2, low: 3 };
const SORT_STORAGE_KEY = 'ablute-pipeline-sort-v1';

// Prompt 529 — replaces PIPELINE_LIST_MAX_HEIGHT_PX (888px = "32.5 thead +
// 15 * 57 row"). Both numbers were re-measured in the live render before
// this change and both were wrong: thead is 29px, and a row today is 53-113px
// (median 73) at 1440px wide, 190-251px (median 218) at 390px. So the 888px
// cap that was meant to show ~15 rows was showing about 4 on a phone.
//
// It is not replaced with a better pixel number, deliberately. That number
// was accurate when written and went stale as soon as a badge was added to a
// row — it will go stale again the moment the next one is. The cap is now
// expressed in ROWS, and enforced in viewport units, so nothing has to be
// re-measured when the row content changes.
//
// 40 = the largest plan quota today (motherfunding, catalog_quota=40). An
// account cannot be delivered more catalog investors than its plan allows, so
// at this cap every catalog-sourced pipeline fits without an internal scroll
// on every plan. Above it the list is genuinely long — manual additions on top
// of a full quota — and its own scroll is the right answer again.
const PIPELINE_ROWS_WITHOUT_SCROLL_CAP = 40;

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
// Self-service, confirmed with Nuno: a button appears and the founder
// triggers the delivery themselves.
//
// Prompt 536 §1 — SELF_SERVICE_COMPLETENESS_THRESHOLD (70% of
// calcCompanyCompleteness) is GONE from this decision, and that removal is
// the fix. Two different definitions of "complete" were live at once: this
// bar opened the button, while isProfileGateComplete() (nine named fields)
// governed the quota. Krohnsty crossed the bar at 13:22 and the gate at
// 13:26 — clicked in between, and the unlock read a quota of 3 instead of
// the 8 it would read four minutes later. The button now gates on exactly
// the predicate that governs the quota, served as `gateComplete` by
// /api/pipeline-unlock, which the page already fetches. Anything less than
// literally the same predicate reopens the race.
type UnlockState = { gateComplete: boolean; catalogQuotaTarget: number; deliverable: number; missing: string[] };
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
function EmptyCompanyBlock({ variant, unlock, onDelivered }: { variant: 'screen' | 'banner'; unlock: UnlockState | null; onDelivered?: () => void }) {
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

  const starterPack = db.packs.find((p) => p.name === STARTER_PACK_NAME);
  // Prompt 536 §1/§3 — one predicate (the profile gate) and one budget
  // (deliverable = quota minus what has already been delivered), both
  // straight from /api/pipeline-unlock. `unlock === null` means the route
  // hasn't answered yet, or auth is off (demo mode): fall back to the old
  // pack-presence check there rather than hiding the button on a page that
  // simply hasn't loaded its state — demo mode has no server to ask.
  const gateComplete = unlock ? unlock.gateComplete : true;
  const deliverable = unlock ? unlock.deliverable : 1;
  const eligible = gateComplete && deliverable > 0 && !!starterPack;

  async function runUnlock() {
    if (!starterPack) return;
    setUnlocking(true);
    const added = await unlockPack(starterPack.id);
    setUnlocking(false);
    setConfirming(false);
    setResult(added > 0 ? 'added' : 'none');
    onDelivered?.();
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
              <button disabled={unlocking} onClick={runUnlock}
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
                ? `Your profile is complete — unlock your first ${deliverable} matched investor${deliverable === 1 ? '' : 's'}, or import your own contacts.`
                : gateComplete
                  // Gate passed but nothing left to give: the quota is spent.
                  // Saying "complete your profile" here would be a lie the
                  // founder can't act on.
                  ? 'Your profile is complete. Your next batch of investors arrives with your plan\u2019s monthly renewal — or import your own contacts now.'
                  // Prompt 536 §1 — name the fields. A percentage from a
                  // different calculation is what produced "70% complete,
                  // now unlock" followed by an under-delivered pipeline.
                  : `To unlock investors from the catalog, complete your company profile${unlock?.missing.length ? ` \u2014 still missing: ${unlock.missing.join(', ')}` : ''}. You can import your own contacts now.`}
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
                {eligible ? 'Import contacts instead' : gateComplete ? 'Import contacts instead' : 'Complete your profile'}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Prompt 536 §3 — the affordance that did not exist, and whose absence is
// why Krohnsty's five earned slots were unreachable.
//
// EmptyCompanyBlock renders on an EMPTY pipeline only. Once the first
// investors land it disappears, and with it the only way a founder had to
// ask for more. Krohnsty ended up with 3 investors, a quota of 8, and no
// button anywhere on the page — the remaining 5 were payable and
// unclaimable until the monthly cron, which is a delivery the founder had
// already earned being withheld for up to a month.
//
// This renders whenever the pipeline is non-empty AND something is owed.
// `deliverable` is quota minus non-exempt deliveries, computed server-side
// by the same route that performs the delivery, so the number in the button
// is the number that arrives. When nothing is owed it renders nothing at
// all — never a disabled button, never a nag. That is the golden rule's
// "show what Sherlock already did before asking for anything": the founder
// is told there are investors waiting, not asked to go fill in a form.
function PipelineTopUpBanner({ unlock, onDelivered }: { unlock: UnlockState | null; onDelivered: () => void }) {
  const { db, unlockPack } = useStore();
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState(false);
  const starterPack = db.packs.find((p) => p.name === STARTER_PACK_NAME);
  const n = unlock?.deliverable ?? 0;
  if (!unlock || !unlock.gateComplete || n <= 0 || !starterPack) return null;

  async function run() {
    if (!starterPack) return;
    setUnlocking(true);
    setError(false);
    const added = await unlockPack(starterPack.id);
    setUnlocking(false);
    if (added === 0) setError(true);
    onDelivered();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0E7490]/20 bg-[#0E7490]/5 px-4 py-3">
      <div className="text-sm text-gray-700">
        <span className="font-medium text-gray-900">{n} more matched investor{n === 1 ? '' : 's'} ready for you.</span>{' '}
        {error
          ? <span className="text-red-700">We couldn&apos;t add them just now — try again in a moment.</span>
          : 'Your profile earned these — they\u2019re waiting in the catalog.'}
      </div>
      <button disabled={unlocking} onClick={run}
        className="shrink-0 rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
        {unlocking ? 'Unlocking\u2026' : `Unlock ${n} more investor${n === 1 ? '' : 's'}`}
      </button>
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
// Prompt 513 §2 — deliberately locale-independent (fixed month names, UTC
// parts) rather than toLocaleDateString: this renders inside a client
// component whose data arrives after hydration, and a locale-dependent
// string here is exactly the kind of thing that starts differing between
// server and client renders later.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
}

function NeglectResultLine({ outcome, last }: { outcome: NeglectOutcome; last: NeglectProposalRecord }) {
  const when = shortDate(last.created_at);
  if (outcome === 'reactivate') {
    return (
      <p className="text-[11px] font-medium text-[#0f5132]">
        → Sherlock proposed a reactivation ({when}) — {last.status === 'pending' ? 'see the queue above.' : 'already resolved in the queue.'}
      </p>
    );
  }
  if (outcome === 'hold_for_hook') {
    return <p className="text-[11px] text-amber-700">Sherlock already checked ({when}): not yet — {last.advice?.holdReason ?? last.rationale}</p>;
  }
  return <p className="text-[11px] text-gray-500">Sherlock already checked ({when}): not worth it — {last.rationale}</p>;
}

// Prompt 513 §2/§3 — the row's whole "Ask Sherlock" area, for BOTH the
// individual link and what "evaluate all" leaves behind. The verdict now
// comes from the persisted reawakening_proposals row, not from React state
// that a reload erases, and re-asking is a SEPARATE, differently-worded
// control ("Ask Sherlock again") so it can never read as a first-time ask.
function NeglectAskCell({ state, asking, onAsk }: {
  state: NeglectAskState; asking: boolean; onAsk: (force: boolean) => void;
}) {
  if (asking) return <p className="mt-0.5 text-[11px] text-gray-400">Asking Sherlock…</p>;
  if (!state.last || !state.outcome) {
    return (
      <button onClick={() => onAsk(false)} className="mt-0.5 text-[11px] font-semibold text-[#0f5132] hover:underline">
        Ask Sherlock
      </button>
    );
  }
  return (
    <div className="mt-0.5 space-y-0.5">
      <NeglectResultLine outcome={state.outcome} last={state.last} />
      {state.manualAskable && (
        <button onClick={() => onAsk(true)} className="text-[11px] text-gray-500 underline decoration-dotted hover:text-[#0f5132]">
          Ask Sherlock again
        </button>
      )}
    </div>
  );
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
  // Prompt 271 §3 / Prompt 272 / Prompt 513 §2 — this state is now ONLY
  // "a request is in flight for these entities". The verdict itself used
  // to live here too, which was the whole bug: 'hold_for_hook' and
  // 'not_worth_it' are recorded in reawakening_proposals but never
  // surfaced by ReawakeningQueue, so this map was the only place the
  // founder ever saw that reasoning — and a reload, a route change or a
  // remount erased it, leaving no trace that the entity had been asked
  // about at all. The verdict is read back from db.reawakeningProposals
  // instead (neglectAskStates below), which is where it always was.
  const [askingIds, setAskingIds] = useState<string[]>([]);
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
  // Prompt 544 Part D — who and how, per row, in ONE call for the whole org.
  // Counts only: catalog_readiness_breakdown never returns a name, an email
  // or a LinkedIn URL (0147 removed public read on catalog_people after a
  // real PII leak, and this must not reopen it).
  const [readinessByEntity, setReadinessByEntity] = useState<Record<string, ReadinessBreakdown>>({});
  // Prompt 123 Block B.2 — the pipeline-unlock engine's live number (base
  // by plan + profile/upload/milestone bonuses + monthly growth). Re-checked
  // whenever entities change so it visibly moves right after a founder
  // completes their profile or uploads a deck, per the block's own
  // acceptance criterion.
  // Prompt 260 §1 — visible/eligiblePoolSize dropped from this local type:
  // they only ever fed PipelineUnlockBadge's now-removed "N of M unlocked"
  // sentence. gateComplete (the badge) and catalogQuotaTarget (the blocked-
  // panel copy below) are the only fields this page still reads.
  // Prompt 536 §1/§3 — `deliverable` and `missing` join the two fields this
  // page already read. Both come from the same route the delivery itself
  // uses, so "Unlock N more investors" and the number actually delivered are
  // the same arithmetic, not two implementations that agreed until they
  // didn't.
  const [unlock, setUnlock] = useState<UnlockState | null>(null);
  const refreshUnlock = useCallback(() => {
    if (!authEnabled) return;
    fetch('/api/pipeline-unlock', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => {
        if (b.ok) setUnlock({
          gateComplete: b.gateComplete, catalogQuotaTarget: b.catalogQuotaTarget ?? 0,
          deliverable: b.deliverable ?? 0, missing: b.missing ?? [],
        });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshUnlock();
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
    browserClient().rpc('catalog_readiness_breakdown', { p_org_id: db.org.id })
      .then(({ data }) => {
        const map: Record<string, ReadinessBreakdown> = {};
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          map[r.entity_id as string] = {
            peopleCount: (r.people_count as number) ?? 0,
            linkedinCount: (r.linkedin_count as number) ?? 0,
            hookCount: (r.hook_count as number) ?? 0,
            hasForm: !!r.has_form, hasEmail: !!r.has_email,
          };
        }
        setReadinessByEntity(map);
      }, () => { /* the strip is extra context, never a reason to fail the page */ });
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
  // Prompt 529 — drives the height rule below. Counts ONLY rows the account
  // already has unlocked (`rows`, the rendered list), never the catalog rows
  // the plan's quota is holding back — those are the frosted panel's business
  // and must not shrink the founder's own list. Deliberately not the raw
  // db.entities length either: `rows` is what is actually rendered under the
  // current view/wave filter, and that is what has to fit.
  const listExceedsCap = rows.length > PIPELINE_ROWS_WITHOUT_SCROLL_CAP;

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

  // Prompt 513 §2 — the persisted history, read once per render pass for
  // every dormant entity. Only dormant ones can be stand_by, so nothing
  // else needs the lookup. Interactions are grouped once rather than
  // filtered per entity: this page routinely renders several hundred rows
  // against a few thousand interactions.
  const neglectAskStates = useMemo(() => {
    const now = new Date();
    const confirmedFacts = db.companyFacts.filter((f) => f.status === 'confirmed');
    const byEntity = new Map<string, Interaction[]>();
    for (const i of db.interactions) {
      if (!i.entity_id) continue;
      const list = byEntity.get(i.entity_id);
      if (list) list.push(i); else byEntity.set(i.entity_id, [i]);
    }
    const map = new Map<string, NeglectAskState>();
    for (const e of db.entities) {
      if (e.status !== 'dormant') continue;
      map.set(e.id, neglectAskState(db.reawakeningProposals, e.id, {
        interactions: byEntity.get(e.id) ?? [], confirmedFacts, now,
      }));
    }
    return map;
  }, [db.entities, db.interactions, db.companyFacts, db.reawakeningProposals]);

  // A never-evaluated entity has no stored state; treat it as a first ask.
  const NEVER_ASKED: NeglectAskState = { autoAskable: true, manualAskable: true, reaskReason: null };
  function askStateFor(entityId: string): NeglectAskState {
    return neglectAskStates.get(entityId) ?? NEVER_ASKED;
  }

  // Prompt 271 §3 — on-demand only, never automatic: askSherlock is only
  // ever called from these two explicit click handlers.
  // Prompt 513 §2 — `force` is set ONLY by the per-row "Ask Sherlock
  // again" click. The bulk button never sets it, so it can no longer
  // re-spend an API call on an entity whose verdict is still current
  // (see neglectAskState's own criterion). The route re-derives the same
  // decision server-side — this flag asks for the override, it doesn't
  // grant it, and a `pending` proposal is never overridable either way.
  async function askSherlockFor(entityIds: string[], force = false) {
    setAskingIds((prev) => [...new Set([...prev, ...entityIds])]);
    try {
      // The verdicts land in reawakening_proposals and come back through
      // the store's own refetch — nothing to keep in local state now, which
      // is exactly why the result survives a reload.
      await askSherlock(entityIds, force);
    } finally {
      setAskingIds((prev) => prev.filter((id) => !entityIds.includes(id)));
    }
  }

  // Prompt 513 §2 — what "evaluate all" would actually spend a call on:
  // stand_by rows in the current view that have never been evaluated, or
  // whose last verdict is no longer current (a new interaction, a newly
  // confirmed company fact, or 30 days — see neglectReaskReason). An
  // in-flight ask is excluded so a double click can't double-bill.
  const bulkAskIds = rows
    .filter((e) => entityFrozenStates.get(e.id) === 'stand_by'
      && !askingIds.includes(e.id)
      && askStateFor(e.id).autoAskable)
    .map((e) => e.id);

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
        <EmptyCompanyBlock variant="screen" unlock={unlock} onDelivered={refreshUnlock} />
      </div>
    );
  }

  return (
    // Prompt 257 §5 built this as "one elevator": the root is a flex column
    // bounded to the viewport, every child keeps its natural size, and the
    // list alone is flex-1 and absorbs whatever is left.
    //
    // Prompt 529 — that is right only while there IS space left. Measured on
    // a real account (Caramel Biscuit, 25 unlocked entities): with the
    // MatchDeal banner and the stats card both showing, the list was handed
    // 460px for ~1,000px of rows, so the founder saw one row of the 25 their
    // own account had. The frosted catalog panel sits immediately below and
    // read as the cause, but it was not: the rows were hidden by a LACK OF
    // HEIGHT, not by the plan's quota. Two different things were sharing one
    // scrollbar.
    //
    // So flex-1 is gone, and with it the viewport binding that existed to
    // feed it. The page is laid out and scrolls normally at every size; the
    // list is sized by its own content, and every row the account already owns
    // is reachable without an inner scrollbar no matter how many banners are
    // stacked above it.
    //
    // Keeping flex-1 for the above-cap case only was tried first and measured:
    // with 59 synthetic rows the list was handed 458px — the same squeeze,
    // just moved to a different account size. A max-height that banners cannot
    // eat into replaces it (on the list itself, below), which is what 257 §5
    // was really reaching for. This inverts its "the page never scrolls"
    // preference; showing the founder their own rows wins.
    <div className="space-y-4">
      {/* P131-A — the banner already existed (Dashboard only, addenda to
          Prompt 120); the founder-facing gap was that Pipeline — the page
          this whole "why can't investors see us" mystery is actually about —
          never had it. Same component, same /api/company/visibility source,
          no new logic. */}
      <div className="md:shrink-0"><MatchDealVisibilityBanner /></div>
      <PageTour pageKey="guide_pipeline" />
      <div className="md:shrink-0"><PipelineUnlockBadge unlock={unlock} /></div>
      <div className="md:shrink-0"><PipelineTopUpBanner unlock={unlock} onDelivered={refreshUnlock} /></div>
      {noneClassified && <div className="md:shrink-0"><EmptyCompanyBlock variant="banner" unlock={unlock} onDelivered={refreshUnlock} /></div>}
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
          title="Reached an impasse — won't move without a change in conditions."
          className={`ml-auto rounded-lg border px-2.5 py-1.5 text-sm font-medium ${frozenView === 'frozen' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {frozenView === 'frozen' ? '❄ Showing frozen' : `❄ Frozen (${frozenCount})`}
        </button>
        <button onClick={() => setFrozenView((v) => v === 'stale' ? 'none' : 'stale')}
          title="Fell through the cracks, for one reason or another."
          className={`rounded-lg border px-2.5 py-1.5 text-sm font-medium ${frozenView === 'stale' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {frozenView === 'stale' ? '💤 Showing stale' : `💤 Stale (${staleCount})`}
        </button>
        {(reportedCount > 0 || frozenView === 'reported') && (
          <button onClick={() => setFrozenView((v) => v === 'reported' ? 'none' : 'reported')}
            title="Not real investors — flagged with evidence (fraud report)."
            className={`rounded-lg border px-2.5 py-1.5 text-sm font-medium ${frozenView === 'reported' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {frozenView === 'reported' ? '🚨 Showing reported' : `🚨 Reported (${reportedCount})`}
          </button>
        )}
        {/* Prompt 271 §3 / Prompt 282 — bulk ask moved to the Stale view
            (Stand by no longer has its own button), but still only ever
            acts on the stand_by rows WITHIN it, never the no_data ones now
            sharing the view — the server-side re-verification itself is
            unchanged. */}
        {/* Prompt 513 §2 — the count is now "not yet evaluated, or evaluated
            and something has since changed", not "no verdict in this
            browser tab's memory". Before, every dismissed verdict was
            invisible to this filter, so the same entities were re-evaluated
            (and re-billed) on every visit — three identical runs in three
            minutes, confirmed in ai_call_log. At 0 the button disappears
            rather than offering a no-op; re-asking one entity is the row's
            own explicit "Ask Sherlock again". */}
        {frozenView === 'stale' && bulkAskIds.length > 0 && (
          <button onClick={() => askSherlockFor(bulkAskIds)}
            className="rounded-lg bg-[#0f5132] px-2.5 py-1.5 text-sm font-medium text-white hover:bg-[#0c4028]">
            Ask Sherlock — evaluate all ({bulkAskIds.length})
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
          exactly the pre-330 layout, no wrapping row/column needed since
          there's only ever one column here now. (The md:flex-1/md:min-h-0
          this used to describe was removed by Prompt 529 — see the root
          div's comment for why.) */}
      {/* Prompt 188 §1 capped this at ~15 rows via a fixed pixel height, so
          the list never grew the whole page. Prompt 529 removed that cap
          below PIPELINE_ROWS_WITHOUT_SCROLL_CAP rows: growing the page is
          now the DESIRED outcome, because the alternative was hiding rows
          the account already owns. */}
      {/* Prompt 192 — corrects 188 §2: the blocked-panel used to live
          inside THIS scroll container, after </table>, so it only became
          visible once the user scrolled the 15-row list all the way down.
          Split back into two sibling divs (blockedCount > 0 below) — this
          one keeps its own scroll and, when a panel follows, only rounds
          its TOP corners and drops its bottom border so the two read as
          one continuous shape with no seam. */}
      {/* Prompt 529 — the height rule, in one place.
          At or below the cap: NO height constraint at all. Not a computed
          pixel target either — with rows measured between 53px and 113px on
          desktop and 190px to 251px on mobile, any single number is wrong for
          most rows in both directions. Letting the table size to its content
          is exact by construction: every row is visible, and the page's own
          scrollbar handles the overflow.
          Above the cap: a viewport-relative cap, so it cannot be squeezed by
          banners the way flex-1 was, and cannot go stale when a row grows a
          badge. overflow-y-auto stays either way — it simply has nothing to do
          in the common case now.
          The frosted catalog panel is unchanged and still the immediate next
          sibling, so it continues to sit directly under the last unlocked row.
          It was never hiding these rows and does not start now. */}
      <div data-tour-id="pipeline-list"
        className={`overflow-x-auto overflow-y-auto border border-gray-100 bg-white shadow-sm ${listExceedsCap ? 'max-h-[75vh]' : ''} ${blockedCount > 0 ? 'rounded-t-2xl border-b-0' : 'rounded-2xl'}`}>
        {/* table-fixed + explicit column widths (colgroup) so the table
            holds to the container's width at every wave filter setting
            instead of growing with content and forcing horizontal scroll;
            cells wrap (see td classes) rather than truncate.
            Prompt 504 §1 — isso continua verdade a partir de md. ABAIXO de
            md nada disto funciona (9 colunas em % dentro de 390px dão ~15px
            à Wave e partem o texto letra a letra), por isso a tabela deixa
            de ser tabela: `pipelineMobile.cards` transforma cada <tr> num
            card. O <colgroup> fica — é inerte quando as colunas não estão em
            display:table-cell — e as classes de tabela passam a `md:`. */}
        <table className={`text-sm md:w-full md:table-fixed ${pipelineMobile.cards}`}>
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
                  <td data-col="name" data-label="Entity" className="break-words px-2 py-1.5 font-medium">
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
                    {/* Prompt 544 Part D — the readiness strip: who is
                        listed, how many can be approached, which channels
                        exist, and whether a hook has been written yet.
                        Zeros show greyed rather than hidden — "0 hooks" is
                        exactly why preflight will refuse the draft. */}
                    {(() => {
                      const b = readinessByEntity[e.id];
                      if (!b || !hasAnythingToShow(b)) return null;
                      return (
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]">
                          {readinessChips(b).map((chip, i) => (
                            <span key={chip.label} className={chip.muted ? 'text-gray-300' : 'text-gray-500'}>
                              {i > 0 && <span className="mr-1.5 text-gray-200">·</span>}{chip.label}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
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
                      <NeglectAskCell
                        state={askStateFor(e.id)}
                        asking={askingIds.includes(e.id)}
                        onAsk={(force) => askSherlockFor([e.id], force)}
                      />
                    )}
                  </td>
                  <td data-col="type" data-label="Type" className="break-words px-2 py-1.5 text-gray-500">{e.type.replace('_', ' ')}</td>
                  <td data-col="hq" data-label="HQ" className="break-words px-2 py-1.5 text-gray-500">{e.hq_city ? `${e.hq_city}, ` : ''}{e.hq_country}</td>
                  <td data-col="check" data-label="Check" className="break-words px-2 py-1.5 text-gray-500">{fmtEur(e.check_min_eur)}–{fmtEur(e.check_max_eur)}</td>
                  <td data-col="sectors" data-label="Sectors" className="px-2 py-1.5">
                    {e.sectors.slice(0, 2).map((s) => (
                      <span key={s} className="mb-1 mr-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{s}</span>
                    ))}
                    {e.sectors.length > 2 && <span className="text-[11px] text-gray-400">+{e.sectors.length - 2}</span>}
                  </td>
                  <td data-col="fit" data-label="Fit" className="px-2 py-1.5"><FitTag fit={e.fit_score} /></td>
                  <td data-col="wave" data-label="Wave" className="px-2 py-1.5"><WaveTag wave={e.wave} /></td>
                  <td data-col="status" data-label="Status" className="px-2 py-1.5"><StatusPill status={e.status} labelOverride={frozenPillLabel(e)} /></td>
                  <td data-col="next_action" data-label="Next action" className="break-words px-2 py-1.5">
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
