// IRM_SPEC §4 — interaction roadmap derivations. Pure functions, sibling to
// rules.ts (kept separate so rules.ts stays scoped to its documented set).
import type { Db, Entity, Interaction, Person, RelationshipStage, TaskItem } from './types';
import { LOCK_DAYS } from './rules';

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

export interface RelatedContact {
  person: Person;
  entity?: Entity;
  lastInteraction?: Interaction;
}

// §4d "consistency across contacts": surfaces people at other entities who
// share a fund/company reference with this entity or person (e.g. Polagnoli
// @ Calm/Storm also built Speedinvest's health team) — matched fuzzily
// against the free-text linked_funds/linked_companies fields already on Person.
export function relatedContacts(db: Db, entityId: string, personId?: string): RelatedContact[] {
  const entity = db.entities.find((e) => e.id === entityId);
  if (!entity) return [];
  const person = personId ? db.people.find((p) => p.id === personId) : undefined;
  const names = new Set(
    [entity.name, ...(person?.linked_funds ?? []), ...(person?.linked_companies ?? [])].map((s) => s.toLowerCase())
  );

  const results: RelatedContact[] = [];
  for (const p of db.people) {
    if (p.entity_id === entityId) continue; // same entity — already visible on this page
    const fields = [...p.linked_funds, ...p.linked_companies].map((s) => s.toLowerCase());
    const overlaps = fields.some((f) => [...names].some((n) => f.includes(n) || n.includes(f)));
    if (!overlaps) continue;
    const lastInteraction = db.interactions.filter((i) => i.person_id === p.id)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    results.push({ person: p, entity: db.entities.find((e) => e.id === p.entity_id), lastInteraction });
  }
  return results;
}
