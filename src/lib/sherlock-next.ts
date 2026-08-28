// Prompt 400 §A.1 — the global "what should I do right now" priority
// ladder for the shell's Sherlock "Next" button (replaces the context-free
// "+ Log interaction"). Deterministic, live, no AI: a pure function of the
// already-loaded store, recomputed every render — same "cheap and pure"
// class of computation Pipeline/Today already do client-side at this scale.
// Consumes rules.ts/relationship.ts, never reimplements them; ready-to-
// contact.ts is itself an extraction of ReadyToContactPanel.tsx's own
// computation for the exact same "don't duplicate" reason.
import type { Db, FitScore } from './types';
type SnoozeField = 'task_id' | 'entity_id' | 'interaction_id' | 'person_id';
import { followUpTaskDisplayTitle, nextBestAction, nextBestActionButton, relationshipSummary } from './relationship';
import { readyToContact } from './ready-to-contact';
// Prompt 417 §A/§B — each reused as-is, none reimplemented: isProfileGateComplete
// already gates Pipeline visibility (the SAME "is this profile functional yet"
// bar, not a second competing one — see step 6's own comment for why that's
// deliberately not companyCompleteness.ts's weighted %); passReasonAlert
// already drives the Dashboard's pass-pattern banner; vaultStrength already
// backs Readiness & Train's own Vault Strength Barometer.
import { isProfileGateComplete } from './pipeline-unlock';
import { passReasonAlert } from './rules';
import { vaultStrength } from './vault-strength';

export type SherlockNextKind =
  | 'interest_request' | 'cap_table_request' | 'unclassified_reply' | 'follow_up_overdue' | 'task_due_today'
  | 'onboarding_profile' | 'onboarding_dataroom' | 'onboarding_pipeline' | 'onboarding_first_message'
  | 'ready_to_contact' | 'pitch_review' | 'readiness_nudge' | 'all_clear';

export interface SherlockNextStep {
  kind: SherlockNextKind;
  label: string;
  entityId?: string;
  personId?: string;
  // Prompt 415 §2 — populated only for the 2 kinds whose natural snooze
  // key is a task/interaction rather than entityId/personId above
  // (interest_request/task_due_today -> taskId, unclassified_reply ->
  // interactionId) — the popup's "Leave for later" needs SOME way to
  // recover the exact candidate to snooze, and entityId/personId alone
  // can't express those two.
  taskId?: string;
  interactionId?: string;
  // Where clicking the button navigates — already carries whatever
  // deep-link params the target panel/page needs (§A.3: ?rail=log&person=,
  // ?rail=history&classify=1).
  target: string;
}

// Mirrors src/app/pipeline/page.tsx's own local `fitOrder` (wave-then-fit is
// that page's own established tie-break order, line ~600) — not exported
// from there since it's a page file, so mirrored here rather than importing
// across a page boundary for a 4-entry map. Exported from HERE (Prompt 414
// §2.2) since liveOverdueEntities below is now a second real consumer
// (TodayPanel's own task-entry tie-break needs the exact same map to sort
// consistently with the live entries it merges alongside) — the original
// "just mirror it, it's 4 entries" reasoning was about avoiding an import
// across a PAGE boundary, which doesn't apply to importing from this
// lib module.
export const FIT_ORDER: Record<FitScore, number> = { high: 0, medium_high: 1, medium: 2, low: 3 };

// Prompt 415 §1.2 — active (not-yet-expired) snoozed candidate ids for one
// kind + natural-key field, e.g. (kind='follow_up_overdue', field=
// 'entity_id'). Only 5 of SherlockNextKind's 12 values ever call this:
// the ones 415 designed a real per-candidate natural key for
// (interest_request/task_due_today -> task_id, follow_up_overdue ->
// entity_id, unclassified_reply -> interaction_id, ready_to_contact ->
// person_id). The 6 onboarding/pitch/readiness kinds Prompt 417 added
// (steps 5-8, 10-11 below) are GLOBAL signals ("your profile isn't
// done", "vault is thin") with no single task/entity/interaction/person
// to key a snooze on — snoozing those would be a real, separate feature;
// migration 0261's own kind constraint stays wide for consistency with
// the type, but nothing here ever inserts/reads a row for those 6.
function activeSnoozedIds(snoozes: Db['sherlockNextSnoozes'], now: Date, kind: SherlockNextKind, field: SnoozeField): Set<string> {
  return new Set(
    snoozes.filter((s) => s.kind === kind && new Date(s.snoozed_until) > now && s[field]).map((s) => s[field] as string),
  );
}

export function sherlockNext(db: Db, now: Date = new Date()): SherlockNextStep {
  // 1 — pending investor interest request (oldest first). Materialized as a
  // `tasks` row (source 'interest_level_request' — 'investor_interest' is
  // declared in the type/DB constraint but nothing currently inserts it;
  // checked anyway since it's a legitimate source value) rather than a
  // separate fetch, so this step stays inside the pure `db` the rest of the
  // ladder already reads. due_at is set to request time on creation
  // (investor-interest-level-db.ts), so ascending due_at IS oldest-first.
  const snoozedInterestTaskIds = activeSnoozedIds(db.sherlockNextSnoozes, now, 'interest_request', 'task_id');
  const pendingInterest = db.tasks
    .filter((t) => !t.done && (t.source === 'interest_level_request' || t.source === 'investor_interest') && !snoozedInterestTaskIds.has(t.id))
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
      kind: 'interest_request', label: `Next: ${t.title}`, entityId: t.entity_id, taskId: t.id,
      // Prompt 415 §3.1 — every OTHER kind below gets ?focus=<kindexactly>,
      // but this one keeps the literal 'interest' value (not
      // 'interest_request') on purpose — 410 already shipped this exact
      // param/value pair, so changing it would silently break any link
      // already saved/bookmarked with the old value.
      target: t.entity_id ? `/entities/${t.entity_id}?focus=interest` : '/today',
    };
  }

  // 2 — pending cap table request (Prompt 423 §B), same featured
  // treatment as step 1 above rather than falling into the generic step-5
  // "task due today" bucket — a specific, named investor ask, not a bare
  // reminder. Detected off the task's own notes marker (item_type:
  // cap_table, set only by the "Request cap table" button, document-
  // requests/route.ts) rather than a join to access_request_items, which
  // isn't part of the local Db this ladder reads — same constraint step 1
  // already documents for its own task-based detection.
  const snoozedCapTableTaskIds = activeSnoozedIds(db.sherlockNextSnoozes, now, 'cap_table_request', 'task_id');
  const pendingCapTable = db.tasks
    .filter((t) => !t.done && t.source === 'document_request' && t.notes?.includes('item_type:cap_table') && !snoozedCapTableTaskIds.has(t.id))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  if (pendingCapTable.length > 0) {
    const t = pendingCapTable[0];
    const entity = t.entity_id ? db.entities.find((e) => e.id === t.entity_id) : undefined;
    return {
      kind: 'cap_table_request', label: `Next: add your cap table for ${entity?.name ?? 'an investor'}`,
      entityId: t.entity_id, taskId: t.id,
      // Prompt 422 §B's own section lives on the Company tab.
      target: '/settings?tab=company',
    };
  }

  // 3 — oldest unclassified reply. Same predicate as
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
  const snoozedReplyInteractionIds = activeSnoozedIds(db.sherlockNextSnoozes, now, 'unclassified_reply', 'interaction_id');
  const unclassified = db.interactions
    .filter((i) => i.direction === 'in' && (!i.classification || i.classification === 'awaiting') && !snoozedReplyInteractionIds.has(i.id))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  if (unclassified.length > 0) {
    const i = unclassified[0];
    const entity = db.entities.find((e) => e.id === i.entity_id);
    return {
      kind: 'unclassified_reply', label: `Next: classify the reply from ${entity?.name ?? 'an investor'}`,
      entityId: i.entity_id, interactionId: i.id,
      target: `/entities/${i.entity_id}?rail=history&classify=1&focus=unclassified_reply`,
    };
  }

  // 4 — most overdue follow-up, tie-broken by wave then fit (best first).
  // nextBestActionButton already encodes "whose turn is overdue, not
  // locked, entity still active" — reused per-entity rather than
  // reimplementing that gate; dealMessageTouches is omitted (empty) because
  // Sherlock messages live outside `db` (fetched per-entity from
  // /api/founder/messages) and this function only ever reads the store, so
  // an entity whose most recent touch was a Sherlock message rather than a
  // logged interaction can undercount here — a known, narrow gap, not a
  // silent one.
  // Prompt 415 §1.2 — a snoozed entity is skipped WITHIN the loop (not
  // just "if the top pick is snoozed, fall through to step 5") — the
  // loop simply never lets it become `mostOverdue`, so the second-most-
  // overdue non-snoozed entity naturally wins instead.
  const snoozedOverdueEntityIds = activeSnoozedIds(db.sherlockNextSnoozes, now, 'follow_up_overdue', 'entity_id');
  let mostOverdue: { entityId: string; personId: string; daysSince: number; wave: number; fitRank: number } | null = null;
  for (const entity of db.entities) {
    if (snoozedOverdueEntityIds.has(entity.id)) continue;
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
      target: `/entities/${mostOverdue.entityId}?rail=log&person=${mostOverdue.personId}&focus=follow_up_overdue`,
    };
  }

  // 5 — task due today (earliest first). Same "today" window Today's own
  // Overdue/This week cards imply (calendar day, not a rolling 24h).
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000);
  const snoozedTaskDueTodayIds = activeSnoozedIds(db.sherlockNextSnoozes, now, 'task_due_today', 'task_id');
  const dueToday = db.tasks
    .filter((t) => !t.done && t.due_at && new Date(t.due_at) >= startOfDay && new Date(t.due_at) < endOfDay && !snoozedTaskDueTodayIds.has(t.id))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  if (dueToday.length > 0) {
    const t = dueToday[0];
    // Prompt 414 §1's own "grep final" missed this one: a follow_up-kind
    // task due exactly today can still be a frozen "Wait for a reply
    // until <today> — then ..." title if due_at's TIME already passed
    // (due today at 09:00, now 14:00) — same bug, same fix.
    return {
      kind: 'task_due_today', label: `Next: ${followUpTaskDisplayTitle(t, now)}`,
      entityId: t.entity_id, taskId: t.id, target: t.entity_id ? `/entities/${t.entity_id}` : '/today',
    };
  }

  // 6 — onboarding: company profile. Checked before any real-contact step
  // below, but never before a REAL pending signal above (1-4) — a founder
  // mid-conversation with an investor on day 1 still gets that reply/
  // request first; onboarding only fills the gap when there's genuinely
  // nothing already in motion. isProfileGateComplete is the same gate
  // pipeline-unlock.ts already uses to decide whether Pipeline shows any
  // investors at all — reused rather than companyCompleteness.ts's
  // weighted Profile Strength %, which answers a different question ("how
  // polished is it", including decorative fields like logo/postal code
  // this gate deliberately excludes) than "is it functional yet".
  if (!isProfileGateComplete(db.org)) {
    return { kind: 'onboarding_profile', label: 'Next: complete your company profile', target: '/settings' };
  }

  // 7 — onboarding: data room. Zero documents means zero evidence for an
  // investor to look at, independent of how complete the profile text is.
  if (db.documents.length === 0) {
    return { kind: 'onboarding_dataroom', label: 'Next: add your first document to the Vault', target: '/documents' };
  }

  // 8 — onboarding: pipeline. No investors yet — nothing downstream of
  // this (contact, follow-up, evaluate) has anything to act on.
  if (db.entities.length === 0) {
    return { kind: 'onboarding_pipeline', label: 'Next: add your first investor to the pipeline', target: '/pipeline' };
  }

  // 9 — onboarding: first message. At least one entity exists (step 8
  // already ruled out zero), but the founder has never actually sent
  // anything — outbound across the WHOLE org, not per-entity, since this
  // is a one-time "you haven't started" signal, not a per-entity nudge
  // (steps 4/10 already own that once outreach is under way). Same
  // wave-then-fit tie-break as step 4's own "best first" (FIT_ORDER, above).
  const everSentOutbound = db.interactions.some((i) => i.direction === 'out');
  if (!everSentOutbound) {
    const firstEntity = [...db.entities].sort((a, b) =>
      (a.wave ?? 9) - (b.wave ?? 9) || FIT_ORDER[a.fit_score ?? 'low'] - FIT_ORDER[b.fit_score ?? 'low'])[0];
    return {
      kind: 'onboarding_first_message', label: `Next: send your first message to ${firstEntity.name}`,
      entityId: firstEntity.id, target: `/entities/${firstEntity.id}?rail=log`,
    };
  }

  // 10 — ready to contact (pre-flight green, wave/seniority order), only
  // while the daily/weekly volume caps still allow it.
  const snoozedReadyPersonIds = activeSnoozedIds(db.sherlockNextSnoozes, now, 'ready_to_contact', 'person_id');
  const { ready, capReached } = readyToContact(db, now);
  const readyFiltered = ready.filter((p) => !snoozedReadyPersonIds.has(p.id));
  if (!capReached && readyFiltered.length > 0) {
    const person = readyFiltered[0];
    const entity = db.entities.find((e) => e.id === person.entity_id);
    if (entity) {
      return {
        kind: 'ready_to_contact', label: `Next: reach out to ${person.full_name}`,
        entityId: entity.id, personId: person.id, target: `/entities/${entity.id}?rail=log&person=${person.id}`,
      };
    }
  }

  // 11 — pitch review: 3+ passes citing the same reason (passReasonAlert,
  // rules.ts), only once nothing from steps 1-10 is pending — real contact
  // never falls behind evaluating the pitch (Nuno's "50% rule", enforced
  // here as ORDER, not hope). Points at the same banner OverviewPanel.tsx
  // already renders for this exact alert — never a second copy of it.
  if (passReasonAlert(db)) {
    return { kind: 'pitch_review', label: 'Next: review why investors are passing', target: '/dashboard' };
  }

  // 12 — readiness nudge: lowest priority, only before all_clear. Gated on
  // a real, already-computed signal (vaultStrength — the same barometer
  // Readiness & Train's own Action Plan tab shows; 'Thin' is its bottom
  // tier, under 30%) rather than a blind cadence, since a cheap signal
  // already exists — see this ladder's own header for why that's the
  // deciding factor, not a coin flip between the two options.
  if (vaultStrength(db.folders, db.documents, now).label === 'Thin') {
    return { kind: 'readiness_nudge', label: 'Next: strengthen your Vault', target: '/readiness?tab=plan' };
  }

  // 13 — nothing actionable right now.
  return { kind: 'all_clear', label: 'All clear', target: '/today' };
}

// Prompt 415 §2.2 — the popup's own explanatory text: reuses the SAME
// phrase Today/SherlockInsightBanner already show for that case, never a
// third, independently-worded copy of the same advice. Only
// follow_up_overdue gets special handling (nextBestAction — e.g. "Follow
// up — no reply for 38d.", the live text those two surfaces already
// render) because it says something genuinely more specific than
// step.label's own generic "reply to {name}"; every other kind's label
// already reads as a complete sentence once its "Next: " prefix (added
// for the shell button's own tooltip concatenation) is stripped.
//
// interest_request is deliberately NOT a case here: its real copy needs
// the investor's name from live InterestRequest[] data only a hook can
// supply (useInterestRequests + interestRequestHeadline, the exact pair
// Prompt 413 already established) — the caller special-cases that one
// kind and falls back to this function for every other.
export function sherlockNextClueCopy(step: SherlockNextStep, db: Db, now: Date = new Date()): string {
  if (step.kind === 'follow_up_overdue' && step.entityId) {
    const text = nextBestAction(db, step.entityId, now);
    if (text) return text;
  }
  // Prompt 423 §B.3 — who asked and why, unlike every other kind's generic
  // label-stripped copy. Resolved straight from db.entities (already
  // available here), unlike interest_request's own copy which needs a
  // hook for the investor's name and is special-cased by the caller
  // instead — this one doesn't need anything sherlockNextClueCopy's own
  // `db` parameter doesn't already carry.
  if (step.kind === 'cap_table_request' && step.entityId) {
    const name = db.entities.find((e) => e.id === step.entityId)?.name ?? 'An investor';
    return `${name} asked for your cap table to estimate their stake — takes 2 minutes.`;
  }
  return step.label.replace(/^Next:\s*/, '');
}

// Prompt 415 §2.2/§3 — the natural snooze key for one step, or null when
// that kind has none (the 6 onboarding/pitch/readiness kinds plus
// all_clear — see activeSnoozedIds' own comment above for why). The
// popup uses this to decide whether "Leave for later" even renders.
export function sherlockNextSnoozeKey(step: SherlockNextStep): { task_id?: string; entity_id?: string; interaction_id?: string; person_id?: string } | null {
  switch (step.kind) {
    case 'interest_request':
    case 'task_due_today':
    case 'cap_table_request':
      return step.taskId ? { task_id: step.taskId } : null;
    case 'follow_up_overdue':
      return step.entityId ? { entity_id: step.entityId } : null;
    case 'unclassified_reply':
      return step.interactionId ? { interaction_id: step.interactionId } : null;
    case 'ready_to_contact':
      return step.personId ? { person_id: step.personId } : null;
    default:
      return null;
  }
}

export interface LiveOverdueEntity {
  entityId: string; personId: string; text: string; daysOverdue: number; wave: number; fitRank: number;
}

// Prompt 414 §2.2 — every entity with a live "reply now" signal (the exact
// same gate step 4 above uses: effectiveMode active, not locked, whoseTurn
// 'overdue'), not just the single most-overdue one step 4 returns. Today's
// own Overdue card uses this to show ALL such entities, not only the ones
// that happened to become a task (accepted from the /log suggestion) —
// an entity the founder clicked "Ignore" on, or only ever touched via a
// Sherlock message, used to be invisible there even though this exact
// signal already pointed at it. `text` comes from nextBestAction, which
// is recomputed live on every call — never a task.title baked in once and
// left to go stale (Prompt 414 §1's own bug).
//
// excludeEntityIds lets the caller skip entities already represented by
// an open task, so a merged (tasks + live entries) list never double-
// counts the same entity — the caller's own responsibility to build that
// set (e.g. from its own task list's entity_ids), since what counts as
// "already represented" is a judgment this function has no way to make
// (Today's Overdue card currently means "any open overdue task").
export function liveOverdueEntities(db: Db, now: Date, excludeEntityIds: Set<string> = new Set()): LiveOverdueEntity[] {
  const results: LiveOverdueEntity[] = [];
  for (const entity of db.entities) {
    if (excludeEntityIds.has(entity.id)) continue;
    const action = nextBestActionButton(db, entity.id, now);
    if (!action) continue;
    const text = nextBestAction(db, entity.id, now);
    if (!text) continue; // defensive — whoseTurn 'overdue' always yields text from nextBestAction
    const summary = relationshipSummary(db, entity.id, now);
    results.push({
      entityId: entity.id, personId: action.personId, text,
      daysOverdue: summary.daysSinceLastTouch ?? 0,
      wave: entity.wave ?? 9, fitRank: FIT_ORDER[entity.fit_score ?? 'low'],
    });
  }
  // Same tie-break as step 4 above: most days overdue first, then earlier
  // wave, then better fit.
  return results.sort((a, b) => b.daysOverdue - a.daysOverdue || a.wave - b.wave || a.fitRank - b.fitRank);
}
