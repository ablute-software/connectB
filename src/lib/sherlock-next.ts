// Prompt 400 §A.1 — the global "what should I do right now" priority
// ladder for the shell's Sherlock "Next" button (replaces the context-free
// "+ Log interaction"). Deterministic, live, no AI: a pure function of the
// already-loaded store, recomputed every render — same "cheap and pure"
// class of computation Pipeline/Today already do client-side at this scale.
// Consumes rules.ts/relationship.ts, never reimplements them; ready-to-
// contact.ts is itself an extraction of ReadyToContactPanel.tsx's own
// computation for the exact same "don't duplicate" reason.
import type { Db, FitScore } from './types';
import { nextBestActionButton, relationshipSummary } from './relationship';
import { readyToContact } from './ready-to-contact';

export type SherlockNextKind =
  | 'interest_request' | 'unclassified_reply' | 'follow_up_overdue' | 'task_due_today' | 'ready_to_contact' | 'all_clear';

export interface SherlockNextStep {
  kind: SherlockNextKind;
  label: string;
  entityId?: string;
  personId?: string;
  // Where clicking the button navigates — already carries whatever
  // deep-link params the target panel/page needs (§A.3: ?rail=log&person=,
  // ?rail=history&classify=1).
  target: string;
}

// Mirrors src/app/pipeline/page.tsx's own local `fitOrder` (wave-then-fit is
// that page's own established tie-break order, line ~600) — not exported
// from there since it's a page file, so mirrored here rather than importing
// across a page boundary for a 4-entry map.
const FIT_ORDER: Record<FitScore, number> = { high: 0, medium_high: 1, medium: 2, low: 3 };

export function sherlockNext(db: Db, now: Date = new Date()): SherlockNextStep {
  // 1 — pending investor interest request (oldest first). Materialized as a
  // `tasks` row (source 'interest_level_request' — 'investor_interest' is
  // declared in the type/DB constraint but nothing currently inserts it;
  // checked anyway since it's a legitimate source value) rather than a
  // separate fetch, so this step stays inside the pure `db` the rest of the
  // ladder already reads. due_at is set to request time on creation
  // (investor-interest-level-db.ts), so ascending due_at IS oldest-first.
  const pendingInterest = db.tasks
    .filter((t) => !t.done && (t.source === 'interest_level_request' || t.source === 'investor_interest'))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  if (pendingInterest.length > 0) {
    const t = pendingInterest[0];
    // Prompt 410 §2.1 — used to always send to /today, where the dossier's
    // own SherlockInsightBanner had no button at all to resolve the exact
    // thing this step is about. Landing ON the entity now means the button
    // that decides it (Approve/Deny, §2.3) is right there — /today stays
    // the fallback for the (currently theoretical, see
    // investor-interest-level-db.ts) case where this task has no entity_id.
    return {
      kind: 'interest_request', label: `Next: ${t.title}`, entityId: t.entity_id,
      target: t.entity_id ? `/entities/${t.entity_id}?focus=interest` : '/today',
    };
  }

  // 2 — oldest unclassified reply. Same predicate as
  // interaction-history.ts's unclassifiedInbound (direction 'in',
  // classification missing or still 'awaiting') — that function takes a
  // single entityId, so the predicate is inlined here to scan globally
  // rather than looping every entity through it; kept identical on purpose
  // so a reply this flags as "still pending" is the same set of rows
  // RecentInteractions' own "N to classify" chip / classifyNonce jump
  // already targets. Deliberately NOT TodayPanel's separate 'unclear'-based
  // definition (a pre-existing, unrelated second definition in that file) —
  // classifyNonce is built around the 'awaiting' one, and this step reuses
  // classifyNonce, so it has to agree with THAT definition, not the other.
  const unclassified = db.interactions
    .filter((i) => i.direction === 'in' && (!i.classification || i.classification === 'awaiting'))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (unclassified.length > 0) {
    const i = unclassified[0];
    const entity = db.entities.find((e) => e.id === i.entity_id);
    return {
      kind: 'unclassified_reply', label: `Next: classify the reply from ${entity?.name ?? 'an investor'}`,
      entityId: i.entity_id, target: `/entities/${i.entity_id}?rail=history&classify=1`,
    };
  }

  // 3 — most overdue follow-up, tie-broken by wave then fit (best first).
  // nextBestActionButton already encodes "whose turn is overdue, not
  // locked, entity still active" — reused per-entity rather than
  // reimplementing that gate; dealMessageTouches is omitted (empty) because
  // Sherlock messages live outside `db` (fetched per-entity from
  // /api/founder/messages) and this function only ever reads the store, so
  // an entity whose most recent touch was a Sherlock message rather than a
  // logged interaction can undercount here — a known, narrow gap, not a
  // silent one.
  let mostOverdue: { entityId: string; personId: string; daysSince: number; wave: number; fitRank: number } | null = null;
  for (const entity of db.entities) {
    const action = nextBestActionButton(db, entity.id, now);
    if (!action) continue;
    const summary = relationshipSummary(db, entity.id, now);
    const candidate = {
      entityId: entity.id, personId: action.personId, daysSince: summary.daysSinceLastTouch ?? 0,
      wave: entity.wave ?? 9, fitRank: FIT_ORDER[entity.fit_score ?? 'low'],
    };
    if (!mostOverdue || candidate.daysSince > mostOverdue.daysSince
      || (candidate.daysSince === mostOverdue.daysSince && candidate.wave < mostOverdue.wave)
      || (candidate.daysSince === mostOverdue.daysSince && candidate.wave === mostOverdue.wave && candidate.fitRank < mostOverdue.fitRank)) {
      mostOverdue = candidate;
    }
  }
  if (mostOverdue) {
    const person = db.people.find((p) => p.id === mostOverdue!.personId);
    return {
      kind: 'follow_up_overdue', label: `Next: reply to ${person?.full_name ?? 'a contact'}`,
      entityId: mostOverdue.entityId, personId: mostOverdue.personId,
      target: `/entities/${mostOverdue.entityId}?rail=log&person=${mostOverdue.personId}`,
    };
  }

  // 4 — task due today (earliest first). Same "today" window Today's own
  // Overdue/This week cards imply (calendar day, not a rolling 24h).
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000);
  const dueToday = db.tasks
    .filter((t) => !t.done && t.due_at && new Date(t.due_at) >= startOfDay && new Date(t.due_at) < endOfDay)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  if (dueToday.length > 0) {
    const t = dueToday[0];
    return {
      kind: 'task_due_today', label: `Next: ${t.title}`,
      entityId: t.entity_id, target: t.entity_id ? `/entities/${t.entity_id}` : '/today',
    };
  }

  // 5 — ready to contact (pre-flight green, wave/seniority order), only
  // while the daily/weekly volume caps still allow it.
  const { ready, capReached } = readyToContact(db);
  if (!capReached && ready.length > 0) {
    const person = ready[0];
    const entity = db.entities.find((e) => e.id === person.entity_id);
    if (entity) {
      return {
        kind: 'ready_to_contact', label: `Next: reach out to ${person.full_name}`,
        entityId: entity.id, personId: person.id, target: `/entities/${entity.id}?rail=log&person=${person.id}`,
      };
    }
  }

  // 6 — nothing actionable right now.
  return { kind: 'all_clear', label: 'All clear', target: '/today' };
}
