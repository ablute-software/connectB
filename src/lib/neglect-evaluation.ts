// Prompt 271 §3 — pure core for Sherlock's ON-DEMAND evaluation of
// dropped_by_us frozen entities (frozen-classifier.ts already decided
// classification; this module never re-decides it, only judges whether/how
// to resurface an already-classified case — same split as Bloco D's
// reawakening-ai-filter.ts). No cron: every call here is triggered by an
// explicit "Ask Sherlock" click, never a periodic scan.
import type { Entity, Interaction } from './types';
import { lastInteractionSummary } from './frozen-classifier';

export type NeglectVerdictKind = 'reactivate' | 'not_worth_it';

export interface NeglectCase {
  entityId: string;
  entityName: string;
  lastInteractionDirection: 'in' | 'out';
  lastInteractionAt: string;
  lastInteractionContent: string;
  touchCount: number;
}

export interface NeglectVerdict {
  verdict: NeglectVerdictKind;
  rationale: string;
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

// `now` is passed in explicitly (never Date.now() inside this pure module)
// so the model has a real anchor for "how long ago" — without one, testing
// against the real API showed it confabulating a relative distance (e.g.
// "just two months ago" for an interaction actually ~17 months old) rather
// than leaving the reasoning ungrounded.
export function buildNeglectEvaluationPrompt(cases: NeglectCase[], now: Date): string {
  const list = cases.map((c, i) =>
    `${i + 1}. entity_id=${c.entityId} · ${c.entityName}\n`
    + `   ${c.touchCount} touch${c.touchCount === 1 ? '' : 'es'}, last message ${c.lastInteractionDirection === 'in' ? 'FROM them' : 'FROM us'} on ${c.lastInteractionAt.slice(0, 10)}\n`
    + `   last message: "${c.lastInteractionContent.slice(0, 500)}"`,
  ).join('\n');
  return `Today's date: ${now.toISOString().slice(0, 10)}.\n\n`
    + 'For EACH of these investor relationships, a thread went cold — no pass was ever recorded, no reopen doctrine was ever set, nobody ever formally closed '
    + 'the door. Decide whether it is worth resurfacing to the founder right now ("reactivate"), and if so propose the CONCRETE next step that actually answers '
    + 'what was left hanging — reference the specific content of the last message when it matters. Or decide it is genuinely not worth it right now '
    + '("not_worth_it") and say why in one sentence. Be honest: a stale, generic "just follow up" is not useful — either give something real and specific to '
    + 'say, or say plainly that it is not worth chasing right now.\n\nCASES:\n' + list;
}

// The DB row shape for one verdict (migration 0192's third origin) — reopens
// true only for 'reactivate' (surfaced in the same reawakening_proposals
// queue as the other two origins), false/'dismissed' for 'not_worth_it'
// (still recorded — "registado", per the prompt — never silently dropped,
// just not actionable). Mirrors reawakening.ts's proposalStatusForVerdict,
// a new function since the verdict shape here isn't a plain boolean.
export function neglectProposalPayload(nc: NeglectCase, verdict: NeglectVerdict) {
  const reopens = verdict.verdict === 'reactivate';
  return {
    entity_id: nc.entityId,
    trigger_kind: 'neglect' as const,
    reopens,
    rationale: verdict.rationale,
    status: (reopens ? 'pending' : 'dismissed') as 'pending' | 'dismissed',
  };
}
