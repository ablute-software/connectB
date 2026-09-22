// Prompt 715 Pedido A/B — the shared substrate for the investor Pipeline's
// signal ledger: one open `investor_opportunity_episodes` row per (firm,
// org) live relationship, and an append-only `investor_signal_events` row
// per act on it. Pure orchestration around two tables; no scoring, no
// learning — that is explicitly out of scope for this phase (Prompt 715
// §10, §Pedido A's own header).
import type { SupabaseClient } from '@supabase/supabase-js';

export type SignalLevel = 'envolvimento' | 'avaliacao_substantiva' | 'progressao' | 'decisao' | 'condicao' | 'contexto' | 'sistema';

export interface PassReasonChip { id: string; label: string; }

// Pedido B — the fixed, private chip vocabulary. Order is display order.
export const PASS_REASON_CHIPS: PassReasonChip[] = [
  { id: 'too_early', label: 'Too early' },
  { id: 'sector_thesis', label: 'Sector / thesis' },
  { id: 'geography', label: 'Geography' },
  { id: 'ticket_size', label: 'Ticket or round size' },
  { id: 'traction', label: 'Traction' },
  { id: 'team_execution', label: 'Team / execution' },
  { id: 'business_model', label: 'Business model' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'portfolio_competitor', label: 'Competitor in portfolio' },
  { id: 'no_capacity_now', label: 'No capacity right now' },
  { id: 'already_knew', label: 'Already knew this one' },
];

// Pedido A §3 — picking "too_early" offers one optional second tap.
// Prompt 716 adds a second question on top of this same chip; this list
// stays exactly what 715 asks for.
export const TOO_EARLY_SUBREASONS: PassReasonChip[] = [
  { id: 'traction', label: 'Traction' },
  { id: 'team', label: 'Team' },
  { id: 'product', label: 'Product' },
  { id: 'market', label: 'Market' },
];

// Pedido B — "os três últimos chips ficam marcados como not_startup_fault
// no código". Derived from the chip id, not a separate stored flag, so a
// future new chip can't need a second place to be marked (see the
// migration's own comment on investor_signal_events).
const NOT_STARTUP_FAULT_CHIP_IDS = new Set(['portfolio_competitor', 'no_capacity_now', 'already_knew']);
export function isNotStartupFaultChip(chipId: string): boolean {
  return NOT_STARTUP_FAULT_CHIP_IDS.has(chipId);
}

// Pedido B, last bullet — matchdeal_swipes.pass_reason (migration 0057)
// keeps its old fixed category check constraint
// ('ticket_too_small'|'outside_thesis'|'too_early'|'other'); the first
// chip that maps onto one of those wins, otherwise 'other'. The event's
// own private_reason_chips array is the real source of truth from here on
// — this mapping exists only so the column doesn't contradict it.
const CHIP_TO_SWIPE_PASS_REASON: Record<string, 'ticket_too_small' | 'outside_thesis' | 'too_early'> = {
  too_early: 'too_early', sector_thesis: 'outside_thesis', ticket_size: 'ticket_too_small',
};
export function swipePassReasonForChips(chips: string[]): 'ticket_too_small' | 'outside_thesis' | 'too_early' | 'other' {
  for (const chip of chips) {
    const mapped = CHIP_TO_SWIPE_PASS_REASON[chip];
    if (mapped) return mapped;
  }
  return 'other';
}

// Whether this firm's activity is exempt from every real count — checked
// from BOTH catalog_entities.is_test (a fictional/demo catalog record) and
// matchdeal_investor_members.is_internal (a real catalog firm whose
// platform ACCOUNT was created by the team, not by that firm itself — the
// distinction migration 0316 documents). Confirmed live, 22/09/2026: EVERY
// matchdeal_investor_members row today, including the one non-is_test firm
// ("Invest green"), has is_internal=true — so this predicate currently
// returns true for the entire platform. That is a fact about today's real
// data, not a bug in this function; see this prompt's own report.
export async function isFirmTestOrInternal(admin: SupabaseClient, investorCatalogEntityId: string): Promise<boolean> {
  const { data: entity } = await admin.from('catalog_entities').select('is_test').eq('id', investorCatalogEntityId).maybeSingle();
  if ((entity as { is_test?: boolean } | null)?.is_test) return true;
  const { data: internalMember } = await admin.from('matchdeal_investor_members').select('id')
    .eq('catalog_entity_id', investorCatalogEntityId).eq('is_internal', true).limit(1).maybeSingle();
  return !!internalMember;
}

// Finds the firm's currently OPEN episode for this org, or opens a new one.
// Prompt 715's own scope never detects a "mudança material" (a new round,
// a stage change) programmatically — nothing in this phase closes an
// episode — so this always continues/reopens rather than ever branching to
// `related_episode_id`. That branch is left for whichever future phase
// actually watches for a material startup-side change; documented here so
// it isn't mistaken for an oversight.
export async function findOrOpenEpisode(
  admin: SupabaseClient, investorCatalogEntityId: string, orgId: string, mandateVersionId?: string | null,
): Promise<string> {
  const { data: open } = await admin.from('investor_opportunity_episodes').select('id')
    .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('org_id', orgId).is('closed_at', null).maybeSingle();
  if (open) return open.id as string;

  const isTestOrInternal = await isFirmTestOrInternal(admin, investorCatalogEntityId);
  const { data: created, error } = await admin.from('investor_opportunity_episodes')
    .insert({
      investor_catalog_entity_id: investorCatalogEntityId, org_id: orgId,
      is_test_or_internal: isTestOrInternal, mandate_version_id: mandateVersionId ?? null,
    })
    .select('id').single();
  if (created) return created.id as string;

  // Lost a race to open the same episode (the partial unique index caught
  // it) — same "re-select on conflict" shape as decide_investor_relationship.
  if (error?.code === '23505') {
    const { data: retryOpen } = await admin.from('investor_opportunity_episodes').select('id')
      .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('org_id', orgId).is('closed_at', null).maybeSingle();
    if (retryOpen) return retryOpen.id as string;
  }
  throw new Error(`findOrOpenEpisode: could not open or find an episode for ${investorCatalogEntityId}/${orgId}: ${error?.message ?? 'unknown error'}`);
}

export interface SignalEventInput {
  episodeId: string;
  actorUserId?: string | null;
  level: SignalLevel;
  kind: string;
  sourceTable?: string | null;
  sourceId?: string | null;
  dedupKey?: string | null;
  privateReasonChips?: string[];
  privateNote?: string | null;
  snapshot?: Record<string, unknown> | null;
  mandateVersionId?: string | null;
  isTestOrInternal: boolean;
}

// Never throws — this is an observational ledger, not a decision path; a
// failure to log a signal must never undo or block the real action that
// triggered it (same posture as every best-effort write in this codebase,
// e.g. recordInvestorDecisionFact). A unique-violation on dedup_key is the
// EXPECTED shape of "this act already has an event" — reported as
// `deduped: true`, not an error.
export async function writeSignalEvent(admin: SupabaseClient, input: SignalEventInput): Promise<{ id: string | null; deduped: boolean }> {
  const { data, error } = await admin.from('investor_signal_events').insert({
    episode_id: input.episodeId,
    actor_user_id: input.actorUserId ?? null,
    level: input.level,
    kind: input.kind,
    source_table: input.sourceTable ?? null,
    source_id: input.sourceId ?? null,
    dedup_key: input.dedupKey ?? null,
    private_reason_chips: input.privateReasonChips ?? [],
    private_note: input.privateNote ?? null,
    snapshot: input.snapshot ?? null,
    mandate_version_id: input.mandateVersionId ?? null,
    is_test_or_internal: input.isTestOrInternal,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') return { id: null, deduped: true };
    console.error('writeSignalEvent failed:', error.message);
    return { id: null, deduped: false };
  }
  return { id: data.id as string, deduped: false };
}

// Pedido A's own dedup rule, made reusable: "mesma firma+org, mesmo
// minuto, mesma acção" collapse onto the SAME dedup_key so a decision and
// its own additive matchdeal_swipes/investor_archive_entries writes never
// mint a second event.
export function decisionDedupKey(investorCatalogEntityId: string, orgId: string, decisionId: string): string {
  return `${investorCatalogEntityId}:${orgId}:decisao:${decisionId}`;
}
