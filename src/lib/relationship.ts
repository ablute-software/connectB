// IRM_SPEC §4 — interaction roadmap derivations. Pure functions, sibling to
// rules.ts (kept separate so rules.ts stays scoped to its documented set).
import type { ActionType, Db, Entity, Interaction, Person, RelationshipStage, TaskItem } from './types';
import { LOCK_DAYS } from './rules';
import { looksLikePersonName } from './structured-import';

// §1c data-quality guard — flags a live entity that is very likely an
// individual person mistyped as an organization (e.g. a solo angel
// imported with no fund). Never auto-converts: surfaced for the founder to
// confirm via convertEntityToPerson/markEntityVerified. last_verified
// doubles as "already reviewed" so a dismissed candidate doesn't keep
// resurfacing; having zero people already on record is a strong signal
// that the "entity" row itself IS the only contact.
export function isPersonCandidate(db: Db, entity: Entity): boolean {
  if (entity.last_verified) return false;
  if (db.people.some((p) => p.entity_id === entity.id)) return false;
  return looksLikePersonName(entity.name, !!entity.website, !!entity.email_domain);
}

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  first_contact: 'First contact', follow_up_no_reply: 'Follow-up · no reply',
  follow_up_thread: 'Follow-up · active thread', research_hook: 'Research hook', other: 'Other',
};

// Shared pill styling for ActionType — used by the Agenda, Today, and §9e
// analysis wherever a task/suggestion is labeled by its tipo de compromisso.
export const ACTION_TYPE_COLOR: Record<ActionType, string> = {
  first_contact: 'bg-blue-100 text-blue-800',
  follow_up_no_reply: 'bg-amber-100 text-amber-800',
  follow_up_thread: 'bg-emerald-100 text-emerald-800',
  research_hook: 'bg-purple-100 text-purple-800',
  other: 'bg-gray-100 text-gray-600',
};

export const ACTION_TYPES: ActionType[] = ['first_contact', 'follow_up_no_reply', 'follow_up_thread', 'research_hook', 'other'];

export const STAGE_ORDER: RelationshipStage[] = ['not_contacted', 'contacted', 'engaged', 'meeting', 'diligence', 'decision'];

export const STAGE_LABEL: Record<RelationshipStage, string> = {
  not_contacted: 'Not contacted', contacted: 'Contacted', engaged: 'Engaged',
  meeting: 'Meeting', diligence: 'Diligence', decision: 'Decision',
};

// relationship_state is a founder-facing overlay, separate from entities.status
// (which keeps driving the existing pipeline/automations). When no row exists
// yet, derive a sensible starting point from entities.status so the stepper
// isn't blank for entities created before this feature shipped.
export function getStage(db: Db, entityId: string): RelationshipStage {
  const row = db.relationshipState.find((r) => r.entity_id === entityId);
  if (row) return row.stage;
  const entity = db.entities.find((e) => e.id === entityId);
  if (!entity) return 'not_contacted';
  switch (entity.status) {
    case 'not_contacted': return 'not_contacted';
    case 'contacted': return 'contacted';
    case 'in_conversation': return 'engaged';
    case 'diligence': return 'diligence';
    case 'passed': case 'invested': return 'decision';
    default: return 'not_contacted'; // dormant — no stage implied
  }
}

export function getNextStepTask(db: Db, entityId: string): TaskItem | undefined {
  const row = db.relationshipState.find((r) => r.entity_id === entityId);
  if (row?.next_step_task_id) {
    const pinned = db.tasks.find((t) => t.id === row.next_step_task_id && !t.done);
    if (pinned) return pinned;
  }
  return db.tasks.filter((t) => t.entity_id === entityId && !t.done)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))[0];
}

export type WhoseTurn = 'us' | 'them' | 'overdue' | 'none';
export type Health = 'stalled' | 'warm' | 'hot' | 'none';

export interface RelationshipSummary {
  stage: RelationshipStage;
  firstContactAt?: string;
  lastTouchAt?: string;
  touchCount: number;
  daysSinceLastTouch?: number;
  whoseTurn: WhoseTurn;
  nextStep?: TaskItem;
  health: Health;
}

export function entityInteractions(db: Db, entityId: string): Interaction[] {
  return db.interactions.filter((i) => i.entity_id === entityId)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export function relationshipSummary(db: Db, entityId: string, now = new Date()): RelationshipSummary {
  const touches = entityInteractions(db, entityId).filter((i) => i.channel !== 'stage_change');
  const first = touches[0];
  const last = touches[touches.length - 1];

  // Whoever made the last move determines whose turn it is next — including
  // the case where they messaged first and we've never replied at all.
  let whoseTurn: WhoseTurn = 'none';
  if (last) {
    if (last.direction === 'in') {
      whoseTurn = 'us';
    } else {
      const days = (now.getTime() - new Date(last.occurred_at).getTime()) / 86_400_000;
      whoseTurn = days >= LOCK_DAYS ? 'overdue' : 'them';
    }
  }

  const daysSinceLastTouch = last
    ? Math.floor((now.getTime() - new Date(last.occurred_at).getTime()) / 86_400_000)
    : undefined;

  const stage = getStage(db, entityId);
  let health: Health = 'none';
  if (touches.length > 0) {
    if (stage === 'meeting' || stage === 'diligence') health = 'hot';
    else if (daysSinceLastTouch !== undefined && daysSinceLastTouch > LOCK_DAYS) health = 'stalled';
    else health = 'warm';
  }

  return {
    stage,
    firstContactAt: first?.occurred_at,
    lastTouchAt: last?.occurred_at,
    touchCount: touches.length,
    daysSinceLastTouch,
    whoseTurn,
    nextStep: getNextStepTask(db, entityId),
    health,
  };
}

export function nextBestAction(db: Db, entityId: string, now = new Date()): string | undefined {
  const entity = db.entities.find((e) => e.id === entityId);
  if (!entity) return undefined;
  const locked = entity.contact_lock_until && new Date(entity.contact_lock_until) > now;
  if (locked) return `Locked until ${entity.contact_lock_until!.slice(0, 10)} — prep the next contact meanwhile.`;

  const summary = relationshipSummary(db, entityId, now);
  if (summary.whoseTurn === 'overdue') return `Follow up — no reply for ${summary.daysSinceLastTouch}d.`;
  if (summary.whoseTurn === 'them') return `Awaiting reply (${summary.daysSinceLastTouch}d) — give it time before following up.`;
  if (summary.stage === 'not_contacted') return 'Ready for first contact — run pre-flight.';
  if (summary.nextStep) return summary.nextStep.title;
  return undefined;
}

// The recommended "tipo de compromisso" for a next-step task on this
// (entity, person) — priority order matches the outreach-discipline rules
// already enforced elsewhere, not a new judgment call:
// 1. hook not researched (person.hook_status) — this is a BLOCKING rule
//    already surfaced by rules.ts's preflight() ("Research first" — a
//    generic message burns the contact permanently), so it outranks
//    everything else: you can't productively plan a contact/follow-up
//    around a person you haven't researched yet.
// 2. no prior interactions with this entity — first_contact.
// 3. last interaction was inbound — follow_up_thread (they moved, reply).
// 4. last interaction was outbound and the 14-day lock has elapsed —
//    follow_up_no_reply.
// 5. otherwise (e.g. outbound but still inside the lock window) — other.
// Reopening a `passed` entity with a reopen_trigger doesn't get its own
// type here — the caller (the /log page) shows the trigger text as a
// separate banner regardless of which of these 5 types applies, per the
// reopen doctrine (cite the earlier "no" + what changed), rather than
// inventing a 6th type not in the requested set.
export function recommendedActionType(db: Db, entityId: string, personId?: string, now = new Date()): ActionType {
  const person = personId ? db.people.find((p) => p.id === personId) : undefined;
  if (person && person.hook_status !== 'researched') return 'research_hook';

  const touches = entityInteractions(db, entityId).filter((i) => i.channel !== 'stage_change');
  if (touches.length === 0) return 'first_contact';

  const last = touches[touches.length - 1];
  if (last.direction === 'in') return 'follow_up_thread';

  const daysSince = (now.getTime() - new Date(last.occurred_at).getTime()) / 86_400_000;
  return daysSince >= LOCK_DAYS ? 'follow_up_no_reply' : 'other';
}

export interface RelatedContact {
  person: Person;
  entity?: Entity;
  lastInteraction?: Interaction;
  viaAffiliation?: boolean; // true = confirmed via person_affiliations (§1c), not just fuzzy text match
}

// §4d "consistency across contacts": surfaces people at other entities who
// are connected to this one — either via a confirmed person_affiliations row
// (§1c — the precise signal) or, absent that, a fuzzy match on the free-text
// linked_funds/linked_companies fields (e.g. Polagnoli @ Calm/Storm also
// built Speedinvest's health team, before anyone had recorded it structurally).
export function relatedContacts(db: Db, entityId: string, personId?: string): RelatedContact[] {
  const entity = db.entities.find((e) => e.id === entityId);
  if (!entity) return [];
  const person = personId ? db.people.find((p) => p.id === personId) : undefined;
  const names = new Set(
    [entity.name, ...(person?.linked_funds ?? []), ...(person?.linked_companies ?? [])].map((s) => s.toLowerCase())
  );

  const affiliatedPersonIds = new Set(
    db.personAffiliations.filter((a) => a.entity_id === entityId).map((a) => a.person_id)
  );

  const results: RelatedContact[] = [];
  for (const p of db.people) {
    if (p.entity_id === entityId) continue; // same entity — already visible on this page
    const viaAffiliation = affiliatedPersonIds.has(p.id);
    const fields = [...p.linked_funds, ...p.linked_companies].map((s) => s.toLowerCase());
    const viaFuzzyMatch = fields.some((f) => [...names].some((n) => f.includes(n) || n.includes(f)));
    if (!viaAffiliation && !viaFuzzyMatch) continue;
    const lastInteraction = db.interactions.filter((i) => i.person_id === p.id)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    results.push({ person: p, entity: db.entities.find((e) => e.id === p.entity_id), lastInteraction, viaAffiliation });
  }
  return results;
}
