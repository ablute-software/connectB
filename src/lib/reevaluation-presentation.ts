// Prompt 716 Pedido C — reapresentação, fora da quota. A reevaluation
// candidate is, by definition, an org this investor already passed on —
// which already exists as an ungated 'passed' RELATIONSHIP card (P132-A:
// "a real grant/decision/investment... not a discovery-quota spend" — a
// passed decision counts too). Relationship cards have never been wave-
// gated in this codebase, so "fora da quota" and "nunca na wave em
// análise" both fall out for free by attaching the reevaluation directly
// to that existing card rather than inventing a parallel wave-injection
// mechanism — the one nuance this drops is showing specifically on "a
// wave seguinte a desbloquear", which has no independent meaning for a
// card that was never wave-gated to begin with (documented in this
// prompt's own report, not silently assumed).
import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_REEVALUATIONS_PER_CALL = 2;

export interface ReevaluationCandidate {
  id: string; orgId: string; conditionKind: string; obstacle: string;
  fulfilledAt: string; fulfilledFactText: string;
}

// Pure: given every fulfilled-but-not-yet-shown condition for a firm
// (already ordered however the caller fetched them), picks the oldest
// MAX_REEVALUATIONS_PER_CALL — "se houver mais, ficam em fila por ordem de
// data do alerta". Never more than the cap, regardless of how many are
// waiting.
export function selectReevaluationsToPresent(candidates: ReevaluationCandidate[]): ReevaluationCandidate[] {
  return [...candidates].sort((a, b) => a.fulfilledAt.localeCompare(b.fulfilledAt)).slice(0, MAX_REEVALUATIONS_PER_CALL);
}

// A 'date' condition has no watch (no consent needed) and so can never
// reach investor_watch_alerts — its own review_by date passing IS its
// fulfillment, checked here directly rather than through the alert
// mechanism. Best-effort; never throws.
export async function fulfillDateConditions(admin: SupabaseClient, investorCatalogEntityId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    await admin.from('investor_reevaluation_conditions')
      .update({ fulfilled_at: new Date().toISOString(), fulfilled_fact_text: 'The date you asked to be reminded on has arrived' })
      .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('condition_kind', 'date')
      .eq('definitive_pass', false).is('fulfilled_at', null).lte('review_by', today);
  } catch (e) {
    console.error('fulfillDateConditions failed:', e);
  }
}

// Fetches every fulfilled-and-unrepresented condition for a firm — the
// pool selectReevaluationsToPresent picks from.
export async function fetchReevaluationCandidates(admin: SupabaseClient, investorCatalogEntityId: string): Promise<ReevaluationCandidate[]> {
  const { data } = await admin.from('investor_reevaluation_conditions')
    .select('id, org_id, condition_kind, obstacle, fulfilled_at, fulfilled_fact_text')
    .eq('investor_catalog_entity_id', investorCatalogEntityId)
    .not('fulfilled_at', 'is', null).is('last_represented_at', null).eq('definitive_pass', false)
    .order('fulfilled_at', { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string, orgId: r.org_id as string, conditionKind: r.condition_kind as string,
    obstacle: r.obstacle as string, fulfilledAt: r.fulfilled_at as string, fulfilledFactText: r.fulfilled_fact_text as string,
  }));
}

// Marks a condition as shown — "last_represented_at e times_represented
// actualizados" — and advances the episode's presentation_cycle (Pedido
// C: "abre um presentation_cycle novo dentro do episódio"). Best-effort;
// a plain read-then-write is fine here (unlike Pedido G's quota count,
// nothing enforces a hard cap on times_represented that a race could
// break — worst case under real concurrency is an undercount by one,
// never an overcount that would violate any rule).
export async function markReevaluationRepresented(admin: SupabaseClient, conditionId: string, episodeId: string): Promise<void> {
  try {
    const { data: condition } = await admin.from('investor_reevaluation_conditions').select('times_represented').eq('id', conditionId).maybeSingle();
    await admin.from('investor_reevaluation_conditions')
      .update({ last_represented_at: new Date().toISOString(), times_represented: ((condition?.times_represented as number) ?? 0) + 1 })
      .eq('id', conditionId);
    const { data: episode } = await admin.from('investor_opportunity_episodes').select('presentation_cycle').eq('id', episodeId).maybeSingle();
    await admin.from('investor_opportunity_episodes')
      .update({ presentation_cycle: ((episode?.presentation_cycle as number) ?? 1) + 1 })
      .eq('id', episodeId);
  } catch (e) {
    console.error('markReevaluationRepresented failed:', e);
  }
}

// Fora do mandato actual — Pedido B's own rule: a fulfilled condition
// whose startup no longer fits the CURRENT mandate never reapresents;
// recorded, not silently dropped. Caller passes whether the card is
// currently excluded (matchReasons already carries this — no second
// computeMatchScore call needed).
export function isOutOfCurrentMandate(matchReasons: string[]): boolean {
  return matchReasons.includes('excluded');
}
