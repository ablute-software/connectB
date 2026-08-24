// Prompt 361 — "Before Sherlock / With Sherlock" era split for the
// Dashboard. Pure, no AI, no migrations: everything here is arithmetic over
// data already in `Db` (interactions, entities, tasks, views) plus one new
// timestamp (org.created_at, "when this founder joined") already in the DB
// and now surfaced on the Org/Interaction types (types.ts).
//
// Root privacy rule (CLAUDE.md) — every function in this file computes
// founder-private performance data (funnel counts, velocity, pipeline
// stats). NEVER wire any of it into company-knowledge.ts or any other
// investor-visible surface — this file exists ONLY for the founder-facing
// Dashboard.
import { stageChangeAt } from './journey';
import type { Db, Entity, Interaction } from './types';

export type EraFilter = 'all' | 'before' | 'platform';
export type InteractionEra = 'before' | 'platform';

// A row came in "before Sherlock" if it was explicitly imported as history
// (source === 'import', regardless of what occurred_at claims — an import
// batch can carry a recent date and still be pre-platform history), OR if
// it's a manually-logged row that occurred before the founder joined
// (occurred_at < joinedAt). Everything else — including every platform-
// native surface, which has no import path at all — is 'platform'.
// No joinedAt (org.created_at missing) means there's nothing to split
// against: everything counts as 'platform', same as "the org has always
// been on the platform."
export function interactionEra(
  i: Pick<Interaction, 'source' | 'occurred_at'>,
  joinedAt: string | null | undefined,
): InteractionEra {
  if (i.source === 'import') return 'before';
  if (joinedAt && i.occurred_at < joinedAt) return 'before';
  return 'platform';
}

// Same rule, generic over any dated record (document views, etc.) that has
// no `source` field of its own — those are all platform-native surfaces by
// construction (no import path exists for a document view), so only the
// date comparison applies.
export function dateEra(occurredAt: string, joinedAt: string | null | undefined): InteractionEra {
  if (joinedAt && occurredAt < joinedAt) return 'before';
  return 'platform';
}

export function matchesEra(era: InteractionEra, filter: EraFilter): boolean {
  return filter === 'all' || era === filter;
}

export interface EraFunnel {
  contacted: number;
  replied: number;
  meeting: number;
  diligence: number;
  committed: number;
}

// Prompt 361 §"casos ambíguos" — the funnel is EVENT-based, not entity-
// based, when a specific era is selected: each of the five stages asks "did
// an event that qualifies for THIS stage happen in THIS era for THIS
// entity", independently per stage. This is deliberate, not an oversight —
// see the "documented semantic" in dashboard-era.test.ts: an entity
// contacted during the imported history and replied-to on-platform counts
// as CONTACTED under "Before Sherlock" AND as REPLIED under "With
// Sherlock". Splitting a single relationship into two disjoint eras would
// misrepresent both — the founder's outreach really did start before the
// platform, and the reply really did happen because of it.
//
// diligence/committed timing is decided by stage_change interactions
// (stageChangeAt, journey.ts) — the only place this data model records
// WHEN a relationship crossed into diligence or reached its outcome. An
// entity currently sitting in "diligence"/"invested" status with no
// stage_change on file (pre-dates the stepper) is counted only in 'all'
// (today's unchanged, status-only behaviour) — there's no honest era to
// assign it to without a recorded transition.
export function funnelByEra(db: Db, era: EraFilter, joinedAt: string | null | undefined): EraFunnel {
  if (era === 'all') {
    return {
      contacted: db.entities.filter((e) => e.status !== 'not_contacted').length,
      replied: new Set(db.interactions.filter((i) => i.direction === 'in').map((i) => i.entity_id)).size,
      meeting: new Set(db.interactions.filter((i) => i.channel === 'meeting' || i.classification === 'meeting_request').map((i) => i.entity_id)).size,
      diligence: db.entities.filter((e) => e.status === 'diligence').length,
      committed: db.entities.filter((e) => e.status === 'invested').length,
    };
  }

  const inEra = (i: Interaction) => matchesEra(interactionEra(i, joinedAt), era);

  const contacted = new Set(db.interactions.filter((i) => i.direction === 'out' && i.channel !== 'stage_change' && inEra(i)).map((i) => i.entity_id)).size;
  const replied = new Set(db.interactions.filter((i) => i.direction === 'in' && inEra(i)).map((i) => i.entity_id)).size;
  const meeting = new Set(db.interactions
    .filter((i) => (i.channel === 'meeting' || i.classification === 'meeting_request') && inEra(i))
    .map((i) => i.entity_id)).size;

  const stageChanges = db.interactions.filter((i) => i.channel === 'stage_change');
  const diligence = new Set(stageChanges.filter((i) => stageChangeAt(i) === 'diligence' && inEra(i)).map((i) => i.entity_id)).size;
  // "Committed" has no dedicated stage in RelationshipStage (STAGE_ORDER
  // tops out at 'decision') — the only recorded transition close to it is
  // the last stage_change reaching 'decision' on an entity the founder has
  // since marked invested. Both conditions are required: the transition
  // alone doesn't mean invested (a 'decision' entity can still be passed).
  const investedIds = new Set(db.entities.filter((e: Entity) => e.status === 'invested').map((e) => e.id));
  const committed = new Set(stageChanges
    .filter((i) => stageChangeAt(i) === 'decision' && investedIds.has(i.entity_id) && inEra(i))
    .map((i) => i.entity_id)).size;

  return { contacted, replied, meeting, diligence, committed };
}

export interface EraContext {
  label: string;
  detail: string;
}

// The context banner above the era selector — "since you joined" for a
// platform-only view, "imported + pre-platform history" for the combined
// or before-only view. Dates are formatted by the caller (locale-aware);
// this only computes the day count and the label/detail split.
export function eraContext(filter: EraFilter, joinedAt: string | null | undefined, now: Date): EraContext | null {
  if (!joinedAt) return null;
  const days = Math.max(0, Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 86_400_000));
  if (filter === 'platform') {
    return { label: 'Since you joined Sherlock', detail: `${days} day${days === 1 ? '' : 's'} ago` };
  }
  if (filter === 'before') {
    return { label: 'Imported + pre-platform history', detail: `up to the day you joined Sherlock` };
  }
  return { label: 'All history', detail: `imported history + ${days} day${days === 1 ? '' : 's'} on Sherlock` };
}

// Prompt 361 §"guardrail de números pequenos" — a platform less than 30
// days old, or a stage with fewer than 5 entities in EITHER era being
// compared, can't support a percentage without being misleading (a single
// entity moving is a 100%/0% swing). Below that bar, the Impact tab shows
// counts only, never a rate.
export function smallNumbersGuard(platformAgeDays: number, ...stageCounts: number[]): boolean {
  return platformAgeDays < 30 || stageCounts.some((n) => n < 5);
}

export function platformAgeDays(joinedAt: string | null | undefined, now: Date): number {
  if (!joinedAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 86_400_000));
}

// Prompt 361 — pass reasons and data-room views both carry their own
// occurred_at/viewed_at directly, so filtering them by era is a plain date
// (+ source, for interactions) comparison — no event/status ambiguity like
// the funnel above.
export function interactionsInEra(interactions: Interaction[], era: EraFilter, joinedAt: string | null | undefined): Interaction[] {
  if (era === 'all') return interactions;
  return interactions.filter((i) => matchesEra(interactionEra(i, joinedAt), era));
}

export function datedInEra<T extends { occurred_at?: string; viewed_at?: string }>(
  rows: T[], era: EraFilter, joinedAt: string | null | undefined, dateOf: (row: T) => string,
): T[] {
  if (era === 'all') return rows;
  return rows.filter((r) => matchesEra(dateEra(dateOf(r), joinedAt), era));
}

// Status breakdown has no honest per-era status to show (an entity's
// status is a live field, not a history) — filtering it by era instead
// answers "of the entities I had activity with in this era, what's their
// status NOW": entities with at least one in-era interaction, current
// status. 'all' keeps today's unchanged, unfiltered behaviour.
export function entitiesActiveInEra(db: Db, era: EraFilter, joinedAt: string | null | undefined): Entity[] {
  if (era === 'all') return db.entities;
  const activeIds = new Set(db.interactions.filter((i) => matchesEra(interactionEra(i, joinedAt), era)).map((i) => i.entity_id));
  return db.entities.filter((e) => activeIds.has(e.id));
}

// ---------------------------------------------------------------------------
// Impact tab (Prompt 361) — velocity and the one mechanical, never-AI
// comparison sentence. Both eras normalise by their OWN real time span, not
// a shared window: "before" spans from the earliest pre-platform
// interaction on file to the join date; "platform" spans from the join
// date to now. A platform three weeks old is never compared as if it had
// the same number of months as five years of imported history.
export interface EraVelocity {
  contacts: number;
  replies: number;
  meetings: number;
  spanDays: number;
  periodLabel: string;
  contactsPerMonth: number;
  repliesPerMonth: number;
  meetingsPerMonth: number;
}

const DAY_MS = 86_400_000;
const iso = (d: string) => d.slice(0, 10);

export function velocityByEra(db: Db, era: 'before' | 'platform', joinedAt: string | null | undefined, now: Date): EraVelocity {
  const rows = interactionsInEra(db.interactions, era, joinedAt);
  const contacts = rows.filter((i) => i.direction === 'out' && i.channel !== 'stage_change').length;
  const replies = rows.filter((i) => i.direction === 'in').length;
  const meetings = rows.filter((i) => i.channel === 'meeting' || i.classification === 'meeting_request').length;

  let spanDays: number;
  let periodLabel: string;
  if (era === 'platform') {
    spanDays = joinedAt ? Math.max(1, Math.floor((now.getTime() - new Date(joinedAt).getTime()) / DAY_MS)) : 1;
    periodLabel = joinedAt ? `${iso(joinedAt)} → today` : 'since joining';
  } else {
    const dates = rows.map((i) => i.occurred_at).sort();
    const earliest = dates[0];
    const latestBoundary = joinedAt ?? dates[dates.length - 1];
    spanDays = earliest && latestBoundary
      ? Math.max(1, Math.floor((new Date(latestBoundary).getTime() - new Date(earliest).getTime()) / DAY_MS))
      : 1;
    periodLabel = earliest && latestBoundary ? `${iso(earliest)} → ${iso(latestBoundary)}` : 'no pre-platform history';
  }
  const months = Math.max(spanDays / 30, 1 / 30);
  return {
    contacts, replies, meetings, spanDays, periodLabel,
    contactsPerMonth: contacts / months, repliesPerMonth: replies / months, meetingsPerMonth: meetings / months,
  };
}

// The one mechanical sentence — plain arithmetic over the two funnels,
// never an AI call (root privacy rule: this is founder-performance data,
// and even setting privacy aside, a sentence this mechanical has no need
// for a model). Falls back to a counts-only phrasing under the small-
// numbers guard, never a percentage that a single entity moving would
// swing by double digits.
export function impactSentence(before: EraFunnel, platform: EraFunnel, guarded: boolean): string {
  if (guarded) {
    return `Early days — before Sherlock you'd contacted ${before.contacted} and heard back from ${before.replied}; `
      + `with Sherlock you've contacted ${platform.contacted} and heard back from ${platform.replied} so far. `
      + `Comparisons firm up as activity accumulates.`;
  }
  const beforeRate = before.contacted > 0 ? Math.round((before.replied / before.contacted) * 100) : 0;
  const platformRate = platform.contacted > 0 ? Math.round((platform.replied / platform.contacted) * 100) : 0;
  return `Before Sherlock you contacted ${before.contacted} investors and heard back from ${before.replied} (${beforeRate}%). `
    + `With Sherlock you've contacted ${platform.contacted} and heard back from ${platform.replied} (${platformRate}%).`;
}
