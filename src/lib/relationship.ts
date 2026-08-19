// IRM_SPEC §4 — interaction roadmap derivations. Pure functions, sibling to
// rules.ts (kept separate so rules.ts stays scoped to its documented set).
import type { ActionType, Channel, Classification, Db, Direction, Entity, Interaction, Person, PassReasonCategory, RelationshipStage, TaskItem } from './types';
import { LOCK_DAYS, preflight, preflightSummary } from './rules';
import { looksLikePersonName } from './structured-import';
import { classifyFrozen, lastInteractionSummary } from './frozen-classifier';

// Prompt 251/253 Bloco A — shared with /log's own pass-category select
// (was duplicated there before this) so there's one list, not two that
// could drift.
export const PASS_REASON_CATEGORIES: PassReasonCategory[] = [
  'valuation', 'check_size', 'geography', 'stage_too_early', 'thesis_mismatch', 'team', 'traction', 'other',
];

// §1c data-quality guard — flags a live entity that is very likely an
// individual person mistyped as an organization (e.g. a solo angel
// imported with no fund). Never auto-converts: surfaced for the founder,
// who can only dismiss it (markEntityVerified) — the actual conversion is
// now a platform_admin-only server action (prompt 33), not something a
// founder can trigger. last_verified doubles as "already reviewed" so a
// dismissed candidate doesn't keep resurfacing; having zero people already
// on record is a strong signal that the "entity" row itself IS the only
// contact.
// §1c(ii) — a thin accessor, not a derivation (prompt 42): unverified_stub_at
// is only ever set by human review (see migration 0049), never inferred from
// field presence, because a source_url can exist and still not prove THIS
// entity specifically (e.g. it points at the real firm's page while this row
// is a barely-documented personal vehicle of one of that firm's partners).
export function isUnverifiedStub(entity: Entity): boolean {
  return !!entity.unverified_stub_at;
}

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

// Prompt 197 C.1 — deal_messages (Sherlock in-app messaging, deal-messages.ts)
// are also "touches" for whoseTurn/health/lastTouchAt purposes, same as a
// manually-logged interactions row. Before this, the two had zero
// connection: a founder replying entirely through Sherlock messaging still
// read as "no reply, overdue" here, because this function only ever looked
// at `interactions` — exactly the gap reported.
//
// Optional and additive on purpose, not a new required param everywhere:
// relationshipSummary is called in BULK, once per row, for every entity in
// the Pipeline table (RelationshipCompactLine) — making it fetch
// deal_messages itself would mean one extra DB round-trip per row. Only
// callers that already have a specific entity's thread loaded (the entity
// detail page, via /api/founder/messages?entityId=) pass dealMessageTouches
// in; every other caller omits it and behaves exactly as before this
// change — direction:'in' means the INVESTOR sent it (founder's turn to
// reply), mirroring Interaction.direction's own convention.
export interface DealMessageTouch { occurredAt: string; direction: Direction }

export function relationshipSummary(
  db: Db, entityId: string, now = new Date(), dealMessageTouches: DealMessageTouch[] = [],
): RelationshipSummary {
  const touches = [
    ...entityInteractions(db, entityId).filter((i) => i.channel !== 'stage_change')
      .map((i) => ({ occurred_at: i.occurred_at, direction: i.direction })),
    ...dealMessageTouches.map((m) => ({ occurred_at: m.occurredAt, direction: m.direction })),
  ].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
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

// Prompt 251-B "Fase 0" — the closed/parked branches used to return one
// static line each ('Passed — closed...', 'Parked — no revisit scheduled.')
// and the Sherlock Tip card that shows it was hidden ENTIRELY for closed/
// parked relationships (RelationshipSummaryCard.tsx's old `!parkedOrClosed
// && action` gate) — the BlueCrow case: a closed dossier said nothing at
// all about whether to leave it alone or reconsider, and the founder had no
// way to tell "intentional silence" from "nothing to say". This derives a
// real answer from data that already exists (the reopen doctrine, migration
// 0016) — zero AI, zero new cron, same "copy computed at render" shape as
// every other branch here. It's the small, immediate fix ahead of Prompt
// 251's much bigger deterministic code-matching matrix, which structures
// `reopen_trigger` instead of just reading it verbatim.
function isReopenEligible(entity: Entity, now: Date): boolean {
  return !!entity.reopen_eligible_after && entity.reopen_eligible_after <= now.toISOString().slice(0, 10);
}

// Coarse on purpose: the prompt's own example only asked for days-vs-years
// granularity. Months as a middle step avoids "92 days" or "0.3 years" for
// the common case of a pass a season ago.
function humanizeAge(sinceIso: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 86_400_000));
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'}`;
}

// Exported so the "+ Set reopen trigger" shortcut in RelationshipSummaryCard
// knows exactly when to offer itself: the one case (§B point 3) where
// NOTHING is registered — the founder gets asked to fix that, not just told.
export function needsReopenTrigger(entity: Pick<Entity, 'status' | 'reopen_trigger' | 'reopen_eligible_after'>): boolean {
  return (entity.status === 'passed' || entity.status === 'dormant')
    && !entity.reopen_trigger && !entity.reopen_eligible_after;
}

// Prompt 254 — preflight() operates on a PERSON, the Tip is about the
// ENTITY. The contact-order doctrine (preflight's own seniority check,
// and the "People — one at a time, senior first" panel) already answers
// "which person does this apply to": whoever the founder would actually
// approach next — the most senior contactable (non-do-not-contact)
// person. Not "the best case" or an "N of M ready" tally: for a
// not-yet-contacted entity there is only ever ONE actionable next
// person, and preflight's own check 5 already blocks anyone else.
export function nextContactPerson(db: Db, entityId: string): Person | undefined {
  return db.people
    .filter((p) => p.entity_id === entityId && !p.do_not_contact)
    .sort((a, b) => a.seniority_rank - b.seniority_rank)[0];
}

export function nextBestAction(db: Db, entityId: string, now = new Date(), dealMessageTouches: DealMessageTouch[] = []): string | undefined {
  const entity = db.entities.find((e) => e.id === entityId);
  if (!entity) return undefined;

  // Prompt 205 §E — parqueado e fechado vêm ANTES de tudo o resto.
  //
  // Confirmado por screenshot em "Test idividual": depois de escolher
  // Frozen, o pill dizia "dormant" e ao lado a mesma página dizia "We owe a
  // reply" e "Ready for first contact — run pre-flight". Três conselhos
  // contraditórios, e o pior deles a mandar contactar quem o founder tinha
  // acabado de parquear.
  //
  // A causa são duas funções, não uma: getStage() devolve 'not_contacted'
  // para dormant ("no stage implied") e esta nunca olhava para o status.
  // Corrige-se aqui porque o conselho é o que o founder lê — e um conselho
  // errado é pior do que nenhum.
  // Prompt 269 §2 — the Tip is Sherlock's own derived opinion; it must
  // never splice a founder's raw free-text reopen_trigger into its own
  // sentence as if it were Sherlock's prose (real case: "Reopens if:
  // nothing nee." — a typo read back as if the app had said it). The Tip
  // now derives ONLY from structured fields (reopen_eligible_after when
  // set, else generic closed/frozen guidance); the raw note, when present,
  // is rendered separately by the caller (RelationshipSummaryCard's own
  // "Your note when freezing" line), clearly attributed and never fused
  // into this string.
  const mode = effectiveMode(db, entityId);
  if (mode === 'parked') {
    const revisit = nextPendingTaskDue(db, entityId);
    if (isReopenEligible(entity, now)) return `Eligible for re-approach since ${entity.reopen_eligible_after}.`;
    if (entity.reopen_trigger) return 'Frozen — reopens once your note (below) comes true.';

    // Prompt 271 §4 — Fase 0 (zero AI, same spirit as 251-B): when this
    // freeze has no pass and no reopen_trigger (both already ruled out
    // above), name the actual fact instead of the generic "no reopen
    // trigger recorded" copy — cheaper, truer, and doesn't wait on an AI
    // evaluation the founder hasn't asked for (§3 is on-demand).
    //
    // Prompt 273 — the two sub-cases read differently on purpose (a real
    // bug in the original 271 wording conflated them): stand_by (they
    // spoke last, WE can fix this unilaterally by replying) reads as a
    // dropped thread, ours to pick back up. frozen_cold (we reached out,
    // THEY never replied — Alter VP's real shape) reads like a pass: it
    // needs a genuine new reason to try again, the same as closed_for_cause
    // just above, never a bare repeat of the same ask.
    const its = db.interactions.filter((i) => i.entity_id === entityId);
    const frozenClass = classifyFrozen(entity, its);
    if (frozenClass === 'stand_by' || frozenClass === 'frozen_cold') {
      const last = lastInteractionSummary(its);
      if (last) {
        return frozenClass === 'stand_by'
          ? `They spoke last (${last.occurredAt.slice(0, 10)}) and never got a reply — this freeze looks like a dropped thread, not a closed door.`
          : `You reached out last (${last.occurredAt.slice(0, 10)}) and never heard back — reopening this needs a real new reason, same as a formal pass.`;
      }
    }
    return revisit
      ? `Frozen — revisit on ${revisit.slice(0, 10)}. No reopen trigger recorded — set one, or leave it frozen.`
      : 'Frozen — no revisit scheduled. No reopen trigger recorded — set one, or leave it frozen.';
  }
  if (mode === 'closed') {
    // Lido do FACTO e nao do status: com a precedencia acima, uma entidade
    // pode estar 'dormant' na coluna e fechada na realidade. Perguntar ao
    // status aqui trazia de volta a incoerencia que isto veio resolver.
    if (entity.status === 'invested') return 'Invested — closed.';

    // Prompt 251/253 Bloco B/C — a deterministic code match takes priority
    // over the generic Fase-0 copy below: it's a SPECIFIC, citable reason
    // ("passed over stage; that bar looks cleared now"), not just "no
    // trigger recorded". Only ever one pending proposal per rejection_code
    // (DB-unique, migration 0186) — but an entity can have SEVERAL codes
    // clear independently (stage AND sector, say), each its own proposal;
    // Bloc C fixed this from a silent `.find` (dropped every reason past
    // the first) to naming all of them, with the full text only when
    // there's exactly one to keep the common case unchanged.
    const pendingReactivations = db.reawakeningProposals.filter((p) => p.entity_id === entityId && p.status === 'pending' && p.reopens && p.rejection_code_id);
    if (pendingReactivations.length === 1) return `↻ ${pendingReactivations[0].rationale}`;
    if (pendingReactivations.length > 1) {
      const axes = pendingReactivations
        .map((p) => db.rejectionCodes.find((c) => c.id === p.rejection_code_id)?.axis_code)
        .filter((a): a is string => !!a);
      return `↻ ${pendingReactivations.length} bars cleared (${axes.join(', ')}) — see the reawakening queue for the full reasons on each.`;
    }

    const lastPass = db.interactions
      .filter((i) => i.entity_id === entityId && i.direction === 'in' && i.classification === 'pass')
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
    const category = lastPass?.pass_reason_category?.replace(/_/g, ' ');

    if (isReopenEligible(entity, now)) {
      const why = category ? ` — the earlier no was about ${category}` : '';
      return `Eligible for re-approach since ${entity.reopen_eligible_after}${why}.`;
    }
    if (entity.reopen_trigger) return `Passed${category ? `, over ${category}` : ''} — reopens once your note (below) comes true.`;
    const age = lastPass ? humanizeAge(lastPass.occurred_at, now) : undefined;
    return `Passed${age ? ` ${age} ago` : ''}${category ? `, over ${category}` : ''}. No reopen trigger recorded — set one, or leave it closed.`;
  }

  const locked = entity.contact_lock_until && new Date(entity.contact_lock_until) > now;
  // Prompt 226 §3 — dizia "Locked until {data}" e não bloqueia nada nesta
  // página: confirmado que `formReady`/`disabledReason` no /log nunca olham
  // para contact_lock. O único efeito real é o preflight pedir "Override &
  // save" com justificação num NOVO outbound dentro dos 14 dias — friction
  // deliberada, não bloqueio. A copy antiga descrevia uma parede que não
  // existe; esta descreve o que de facto se passa.
  if (locked) return `Recently contacted — give it until ${entity.contact_lock_until!.slice(0, 10)} before following up.`;

  const summary = relationshipSummary(db, entityId, now, dealMessageTouches);
  if (summary.whoseTurn === 'overdue') return `Follow up — no reply for ${summary.daysSinceLastTouch}d.`;
  if (summary.whoseTurn === 'them') return `Awaiting reply (${summary.daysSinceLastTouch}d) — give it time before following up.`;
  // Prompt 254 — used to tell the founder to "run pre-flight" themselves:
  // an order in jargon, with nothing to click and nothing that happened.
  // preflight() is pure and already runs on this same page (the People
  // panel below) — there's no reason to ask the founder to do what the
  // code can just do and show. This now names the RESULT.
  if (summary.stage === 'not_contacted') {
    const person = nextContactPerson(db, entityId);
    if (!person) return 'Add a contact person first — pre-flight needs one to check.';
    const result = preflightSummary(preflight(db, person, null, now));
    if (result.green) return `Ready for first contact — pre-flight clear for ${person.full_name}.`;
    return `Not ready yet — pre-flight found ${result.failed.length} issue${result.failed.length === 1 ? '' : 's'} for ${person.full_name}:`;
  }
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

export interface NextActionSuggestion {
  title: string;
  dueAt: string; // ISO date
  actionType: ActionType;
}

// Prompt 65 Bloco 4 — "the next action should come from the engine, not the
// founder." Channel/classification -> suggestion table, shown here (this IS
// the table the prompt asked to see before applying it):
//
//   Outbound, by channel (waiting for a reply):
//     web_form, email, linkedin_dm, linkedin_note, intro -> "Wait for a
//       reply until <occurred_at + 14d> — then follow up <via that channel>"
//       (follow_up_no_reply, 14 days — same LOCK_DAYS window the contact
//       lock itself already uses, so the suggestion and the lock always
//       agree on when it's legitimate to re-approach).
//     call, meeting, event -> shorter windows (3d / 2d / 3d) tagged
//       follow_up_thread: these are synchronous touches with momentum to
//       protect, not a cold message waiting on a reply.
//
//   Inbound, by classification:
//     meeting_request -> "Schedule the meeting" (follow_up_thread, 2d)
//     interested       -> "Move the conversation forward" (follow_up_thread, 3d)
//     question         -> "Answer their question" (follow_up_thread, 2d)
//     out_of_office    -> "Follow up once they're back" (follow_up_no_reply, 10d)
//     pass, awaiting, bounce, unclear -> no suggestion (a pass closes the
//       relationship rather than opening a next step; the other three are
//       either not yet actionable or need a human read first).
const OUTBOUND_CHANNEL_SUGGESTION: Partial<Record<Channel, { verb: string; dueInDays: number; actionType: ActionType }>> = {
  web_form: { verb: 'follow up via the same form', dueInDays: LOCK_DAYS, actionType: 'follow_up_no_reply' },
  email: { verb: 'follow up by email', dueInDays: LOCK_DAYS, actionType: 'follow_up_no_reply' },
  linkedin_dm: { verb: 'follow up on LinkedIn', dueInDays: LOCK_DAYS, actionType: 'follow_up_no_reply' },
  linkedin_note: { verb: 'follow up on LinkedIn', dueInDays: LOCK_DAYS, actionType: 'follow_up_no_reply' },
  intro: { verb: 'follow up on the introduction', dueInDays: LOCK_DAYS, actionType: 'follow_up_no_reply' },
  call: { verb: 'follow up after the call', dueInDays: 3, actionType: 'follow_up_thread' },
  meeting: { verb: 'follow up after the meeting', dueInDays: 2, actionType: 'follow_up_thread' },
  event: { verb: 'follow up after the event', dueInDays: 3, actionType: 'follow_up_thread' },
};

const INBOUND_CLASSIFICATION_SUGGESTION: Partial<Record<Classification, { title: string; dueInDays: number; actionType: ActionType }>> = {
  meeting_request: { title: 'Schedule the meeting', dueInDays: 2, actionType: 'follow_up_thread' },
  interested: { title: 'Move the conversation forward', dueInDays: 3, actionType: 'follow_up_thread' },
  question: { title: 'Answer their question', dueInDays: 2, actionType: 'follow_up_thread' },
  out_of_office: { title: "Follow up once they're back", dueInDays: 10, actionType: 'follow_up_no_reply' },
};

export function suggestNextAction(
  direction: Direction, channel: Channel, classification: Classification | undefined, occurredAt: string,
): NextActionSuggestion | null {
  if (direction === 'out') {
    const rule = OUTBOUND_CHANNEL_SUGGESTION[channel];
    if (!rule) return null;
    const dueAt = new Date(new Date(occurredAt).getTime() + rule.dueInDays * 86_400_000).toISOString();
    return { title: `Wait for a reply until ${dueAt.slice(0, 10)} — then ${rule.verb}`, dueAt, actionType: rule.actionType };
  }
  const rule = classification ? INBOUND_CLASSIFICATION_SUGGESTION[classification] : undefined;
  if (!rule) return null;
  const dueAt = new Date(new Date(occurredAt).getTime() + rule.dueInDays * 86_400_000).toISOString();
  return { title: rule.title, dueAt, actionType: rule.actionType };
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

// Prompt 202 §A.2 + §E — que saídas o stepper oferece num dado momento.
//
// Vive aqui, e não dentro do RelationshipSummaryCard, por duas razões: é
// decisão de negócio (que saídas existem e quando), e é a única forma de a
// testar — o projecto não tem testes de componentes, tem testes de funções
// puras. O componente passa a desenhar o que esta função decide.
//
// O caso que motivou isto: pass da Adara Ventures (2026-08-05). O banner
// antigo só olhava para whoseTurn/stage, ignorava o que a pessoa disse, e a
// única saída que oferecia era "Mark as Engaged?" — a app sugeriu avançar
// com um investidor que tinha dito que não, e o founder clicou.
export interface StageExits {
  show: boolean;
  // true quando a última interação RECEBIDA está classificada como pass.
  // Nesse caso a saída "avançar" desaparece de todo: é o bug do caso Adara.
  lastInboundWasPass: boolean;
  canAdvance: boolean;
  nextStage: RelationshipStage;
  // 'contacted' nunca teve resposta nenhuma, portanto "frozen" leria mal —
  // o que aconteceu foi ficar frio. Mesmo mecanismo (entities.status
  // 'dormant'), rótulo honesto.
  parkLabel: 'cold' | 'frozen';
}

export function stageExits(
  db: Db, entity: Entity, now: Date = new Date(), dealMessageTouches: DealMessageTouch[] = [],
): StageExits {
  const s = relationshipSummary(db, entity.id, now, dealMessageTouches);
  const lastInbound = db.interactions
    .filter((i) => i.entity_id === entity.id && i.direction === 'in')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .at(-1);
  const lastInboundWasPass = lastInbound?.classification === 'pass';
  const idx = STAGE_ORDER.indexOf(s.stage);
  const nextStage = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];

  // Já decidido (stage 'decision', ou status passed/dormant) não tem saídas:
  // não há nada a sugerir a quem já saiu do funil.
  const stageIsActive = s.stage !== 'decision' && entity.status !== 'passed' && entity.status !== 'dormant';
  // 'not_contacted' fica de fora: não há contacto nenhum de que sair.
  //
  // Ajuste do Nuno (2026-08-15): 'overdue' também abre o banner. É o caso de
  // quem nunca respondeu — precisamente aquele em que o founder precisa de
  // uma saída e não tinha nenhuma, porque só se mostrava o banner quando a
  // vez era nossa. Aí só fazem sentido as saídas 2 e 3 (passed / cold): não
  // há resposta nenhuma que justifique "avançar de estágio", e avançar às
  // cegas era a versão anterior deste mesmo bug.
  const show = stageIsActive && s.stage !== 'not_contacted'
    && (s.whoseTurn === 'us' || s.whoseTurn === 'overdue' || lastInboundWasPass);

  // Prompt 214 §C.3 (revisto no 249 §A) — a nudge automática continuava a não
  // empurrar para 'decision' sozinha: "Responderam" NAO e "decidiram". O que
  // mudou no 249 e que "Decision" deixou de estar ESCONDIDO do botão — o
  // founder pode agora iniciar manualmente um "Move to Decision", só que o
  // clique já não avança direto: abre um passo de confirmação que pede o
  // desfecho (passed/invested) e, para passed, a razão. canAdvance continua
  // a significar "há uma saída de avanço para oferecer" — é o COMPONENTE,
  // vendo nextStage === 'decision', que decide abrir a confirmação em vez de
  // avançar logo. A regra de que Decision nunca existe sem desfecho+razão
  // não mudou; só mudou quem pode iniciá-lo.
  //
  // Caso real que motivou o guard original: o founder moveu Meeting-
  // >Diligence por engano e a app respondeu com "Move to Decision", ou seja
  // empurrou-o mais para a frente em vez de o deixar recuar. Isso continua
  // impossível: canAdvance ainda exige s.whoseTurn === 'us' (a vez é nossa),
  // não uma sugestão cega.
  return {
    show,
    lastInboundWasPass,
    canAdvance: show && !lastInboundWasPass && s.whoseTurn === 'us',
    nextStage,
    parkLabel: s.stage === 'contacted' ? 'cold' : 'frozen',
  };
}

// Prompt 205 §E — em que "modo" está esta relação, para o ecrã inteiro poder
// concordar consigo próprio. Não é um estado novo: lê o entities.status que
// já existe. Existe porque três sítios diferentes precisavam da mesma
// resposta e cada um a inferia à sua maneira (o stepper pelo stage, o chip
// pelo whoseTurn, o conselho por nenhum dos dois).
export type EntityMode = 'active' | 'parked' | 'closed';

export function entityMode(entity: Pick<Entity, 'status'>): EntityMode {
  if (entity.status === 'dormant') return 'parked';
  if (entity.status === 'passed' || entity.status === 'invested') return 'closed';
  return 'active';
}

// Prompt 209 (resto) — a MESMA precedencia do journeySteps, agora disponivel
// para a pagina inteira: um pass classificado e desfecho, e desfecho ganha a
// um parque herdado de antes.
//
// O caso real: a Adara foi classificada como pass e SO DEPOIS parqueada com
// o botao "Mark dormant" (dormant_since 2026-08-16 12:16, razao "Manually
// parked"). Parquear depois de fechar e uma accao legitima -- o que nao pode
// e a pagina dizer "Declined" no stepper e "Parked" duas linhas abaixo.
//
// entityMode() continua a existir e a ser o mapeamento puro do status. Esta
// e a leitura com os FACTOS por cima, e e a que as superficies devem usar.
export function effectiveMode(db: Db, entityId: string): EntityMode {
  const entity = db.entities.find((e) => e.id === entityId);
  if (!entity) return 'active';
  const base = entityMode(entity);
  if (base === 'closed') return 'closed';

  const lastInbound = db.interactions
    .filter((i) => i.entity_id === entityId && i.direction === 'in')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .at(-1);
  return lastInbound?.classification === 'pass' ? 'closed' : base;
}

// A data da próxima tarefa pendente da entidade — depois de parquear é a
// task de revisit, mas não se assume isso pelo título: se o founder criou
// outra coisa mais cedo, é essa que interessa.
export function nextPendingTaskDue(db: Db, entityId: string): string | undefined {
  return db.tasks
    .filter((t) => t.entity_id === entityId && !t.done && !!t.due_at)
    .map((t) => t.due_at as string)
    .sort((a, b) => a.localeCompare(b))[0];
}
