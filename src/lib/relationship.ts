// IRM_SPEC §4 — interaction roadmap derivations. Pure functions, sibling to
// rules.ts (kept separate so rules.ts stays scoped to its documented set).
import type { ActionType, Channel, Classification, Db, Direction, Entity, Interaction, Person, RelationshipStage, TaskItem } from './types';
import { LOCK_DAYS } from './rules';
import { looksLikePersonName } from './structured-import';

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

export function nextBestAction(db: Db, entityId: string, now = new Date(), dealMessageTouches: DealMessageTouch[] = []): string | undefined {
  const entity = db.entities.find((e) => e.id === entityId);
  if (!entity) return undefined;
  const locked = entity.contact_lock_until && new Date(entity.contact_lock_until) > now;
  if (locked) return `Locked until ${entity.contact_lock_until!.slice(0, 10)} — prep the next contact meanwhile.`;

  const summary = relationshipSummary(db, entityId, now, dealMessageTouches);
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

  return {
    show,
    lastInboundWasPass,
    canAdvance: show && !lastInboundWasPass && s.whoseTurn === 'us',
    nextStage,
    parkLabel: s.stage === 'contacted' ? 'cold' : 'frozen',
  };
}
