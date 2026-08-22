// Prompt 271 §3 / Prompt 272 — pure core for Sherlock's ON-DEMAND
// evaluation of stand_by frozen entities (frozen-classifier.ts
// already decided classification; this module never re-decides it, only
// judges whether/how to resurface an already-classified case — same split
// as Bloco D's reawakening-ai-filter.ts). No cron: every call here is
// triggered by an explicit "Ask Sherlock" click, never a periodic scan.
//
// Prompt 272 — upgraded from a single rationale paragraph to the 5
// elements a real fundraising adviser's advice always has: what to
// acknowledge, what to answer (the pending content, cited verbatim —
// never paraphrased into vagueness), the new hook that justifies
// reopening now (or, honestly, that there isn't one yet), and who/how/
// when to send it. "hold_for_hook" is the third, deliberately distinct
// outcome from "not_worth_it": the thread is real and worth answering,
// there just isn't a genuine new reason to reopen yet — "an adviser
// worth listening to also says 'not yet'" (the prompt's own framing),
// with a concrete "go create this first" instead of silence.
import type { Entity, Interaction, NeglectAdvice } from './types';
import { lastInteractionSummary } from './frozen-classifier';
import { wrapDocumentContent } from './prompt-injection-defense';

export type NeglectOutcome = 'reactivate' | 'hold_for_hook' | 'not_worth_it';

export interface NeglectCase {
  entityId: string;
  entityName: string;
  lastInteractionDirection: 'in' | 'out';
  lastInteractionAt: string;
  lastInteractionContent: string;
  touchCount: number;
}

// What the AI itself decides — never the person (nextContactPerson,
// relationship.ts, is deterministic/seniority-doctrine-governed; the
// caller merges personId/personName in afterward, see neglectAdviceRow).
export interface NeglectVerdict {
  outcome: NeglectOutcome;
  rationale: string;
  acknowledge?: string;
  respondTo?: { question: string; answer: string }[];
  newHook?: string;
  holdReason?: string;
  channel?: string;
  timing?: string;
}

// Privacy (§3): built ONLY from this entity's own interactions, already
// scoped to the caller's org by the route that fetches them — no cross-org
// data ever enters this case or the prompt built from it.
export function entityToNeglectCase(entity: Pick<Entity, 'id' | 'name'>, interactions: Interaction[]): NeglectCase | undefined {
  const last = lastInteractionSummary(interactions);
  if (!last) return undefined;
  const lastFull = [...interactions].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  return {
    entityId: entity.id, entityName: entity.name,
    lastInteractionDirection: last.direction, lastInteractionAt: last.occurredAt,
    lastInteractionContent: lastFull?.content ?? '', touchCount: interactions.length,
  };
}

// `now` passed in explicitly (never Date.now() inside this pure module) —
// testing against the real API showed the model confabulating a relative
// distance ("just two months ago" for something ~17 months old) without a
// stated anchor date.
//
// `companyFacts` — confirmed Company Canon facts only (same provenance
// gate as compose's own canonBlock, /api/compose/route.ts): newHook must
// cite one of these ids, never invented. Same anti-hallucination
// discipline as entity-enrichment.ts's "drop rather than guess" — an
// entity with no genuine new fact to point to gets holdReason, not a
// fabricated hook.
export function buildNeglectEvaluationPrompt(
  cases: NeglectCase[], now: Date, companyFacts: { id: string; statement: string; category: string }[],
): string {
  const list = cases.map((c, i) =>
    `${i + 1}. entity_id=${c.entityId} · ${c.entityName}\n`
    + `   ${c.touchCount} touch${c.touchCount === 1 ? '' : 'es'}, last message ${c.lastInteractionDirection === 'in' ? 'FROM them' : 'FROM us'} on ${c.lastInteractionAt.slice(0, 10)}\n`
    // Prompt 305 §B — an inbound last message is investor-authored
    // (third-party) content; wrap it as data, not instructions.
    + `   last message: ${wrapDocumentContent(c.lastInteractionContent.slice(0, 500))}`,
  ).join('\n');
  const factsBlock = companyFacts.length
    ? `\n\nCONFIRMED COMPANY FACTS (the ONLY facts you may cite as the "new hook" — quote/paraphrase one, never invent one):\n${companyFacts.map((f) => `[${f.id}] (${f.category}) ${f.statement}`).join('\n')}`
    : '\n\nNo confirmed company facts are on file — there is nothing real to cite as a new hook right now, so no case here can get outcome="reactivate"; the best any of them can get is "hold_for_hook" (if the thread itself is worth answering once there IS one) or "not_worth_it".';
  return `Today's date: ${now.toISOString().slice(0, 10)}.\n\n`
    + 'You are advising a startup founder, as their fundraising adviser, on investor threads that went cold — no pass was ever recorded, no reopen '
    + 'doctrine was ever set, nobody ever formally closed the door. A real adviser\'s advice always has the same shape: (1) acknowledge the real gap in '
    + 'one honest line, no drama, no long apology; (2) answer what was actually left pending — quote or closely paraphrase each real question/point from '
    + 'the last message, never merge them into one vague line; (3) name the genuine NEW reason to reopen now, grounded in a real confirmed company fact '
    + '(never invented) — if there truly is none yet, say so plainly and name what would have to happen first; (4) suggest channel and timing.\n\n'
    + 'For EACH case, decide: "reactivate" (a real new hook exists — give all 4 elements above plus channel/timing), "hold_for_hook" (the thread is real '
    + 'and worth answering, but there is no genuine new reason to reopen yet — give elements 1-2 plus holdReason instead of newHook, no channel/timing '
    + 'needed since nothing sends yet), or "not_worth_it" (the thread itself has nothing real to answer — e.g. a one-word non-reply from years ago — just '
    + 'say why in rationale, skip the rest). Be honest: a stale generic "just follow up" is never useful.' + factsBlock + '\n\nCASES:\n' + list;
}

// The DB row shape for one verdict (migration 0192's third origin +
// migration 0193's advice column). reopens/status only ever distinguish
// "ready to draft now" from "not, for whatever reason" — hold_for_hook and
// not_worth_it get the SAME (reopens:false, status:'dismissed') DB
// treatment (neither is approvable via ReawakeningQueue — there's nothing
// to send yet either way), but keep different `advice` content so the
// Pipeline row's inline feedback (the only place a founder ever sees a
// non-reactivate verdict) still reads right for each.
export function neglectProposalPayload(
  entityId: string, verdict: NeglectVerdict, person?: { id: string; full_name: string },
) {
  const reopens = verdict.outcome === 'reactivate';
  const advice: NeglectAdvice | undefined = verdict.outcome === 'not_worth_it' ? undefined : {
    acknowledge: verdict.acknowledge ?? '',
    respondTo: verdict.respondTo ?? [],
    newHook: verdict.outcome === 'reactivate' ? verdict.newHook : undefined,
    holdReason: verdict.outcome === 'hold_for_hook' ? verdict.holdReason : undefined,
    channel: verdict.outcome === 'reactivate' ? verdict.channel : undefined,
    timing: verdict.outcome === 'reactivate' ? verdict.timing : undefined,
    personId: verdict.outcome === 'reactivate' ? person?.id : undefined,
    personName: verdict.outcome === 'reactivate' ? person?.full_name : undefined,
  };
  return {
    entity_id: entityId,
    trigger_kind: 'neglect' as const,
    reopens,
    rationale: verdict.rationale,
    advice,
    status: (reopens ? 'pending' : 'dismissed') as 'pending' | 'dismissed',
  };
}
