// P136 — I/O side of the disclosure ladder; the actual level-computation
// and field-projection rules stay pure and are tested in isolation over in
// investor-interest-level.ts. This file only ever talks to the DB via a
// service-role client, matching investor_interest_levels' own zero-policy
// RLS (0131).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InterestLevelRow } from './investor-interest-level';

export interface InterestLevelRowFull extends InterestLevelRow {
  id: string; requestedAt: string; decidedAt: string | null; note: string | null; shareDirectEmail: boolean;
}

// Server-internal only — carries `note` (the founder's own private reason
// for granting/denying) and `id` (needed to target a decision). NEVER
// return this shape directly from a route the investor's session can
// read; see toInvestorFacingLevelRows below for the one that's safe to
// send. (Bug found in relatorio_verificacao_..._8143c75_p136: both portal
// routes were forwarding this whole object to the investor, `note`
// included — the exact "fetched, not hidden" failure this feature exists
// to prevent, one field over.)
export async function getInterestLevelRows(admin: SupabaseClient, orgId: string, investorCatalogEntityId: string): Promise<InterestLevelRowFull[]> {
  const { data } = await admin.from('investor_interest_levels')
    .select('id, level, status, requested_at, decided_at, note, share_direct_email')
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId);
  return (data ?? []).map((r) => ({
    id: r.id as string, level: r.level as 2 | 3, status: r.status as 'granted' | 'pending' | 'denied',
    requestedAt: r.requested_at as string, decidedAt: r.decided_at as string | null,
    note: r.note as string | null, shareDirectEmail: r.share_direct_email as boolean,
  }));
}

// The ONLY shape ever sent to the investor's own session — level and
// status, nothing else. `note` is the founder's private reasoning for a
// grant/deny decision and stays server-side; requestedAt/decidedAt/
// shareDirectEmail/id have no investor-facing UI today either, so they're
// dropped too rather than kept "just in case" (the narrower the exported
// shape, the harder this exact bug is to reintroduce).
export function toInvestorFacingLevelRows(rows: InterestLevelRowFull[]): InterestLevelRow[] {
  return rows.map((r) => ({ level: r.level, status: r.status }));
}

// Level 2 — frictionless: granted the instant it's asked for (§3 of
// prompt_136 — the gate isn't the point, the signal is). Level 3 — always
// created as 'pending'; the founder decides via decideLevel3 below.
// Idempotent per (org, investor, level): a second request when a row
// already exists returns early, unchanged, never a duplicate or a silent
// overwrite of a founder's denial. The early-return itself is a
// select-then-check (TOCTOU, not atomic); the real guarantee against two
// simultaneous requests racing past it is the UNIQUE (org_id,
// investor_catalog_entity_id, level) constraint on the table — a genuine
// race fails safe with a constraint-violation error, never a duplicate row
// (corrected 2026-08-06: the prior wording credited the constraint with the
// early-return's own job).
//
// This early-return has a real consequence worth knowing before touching
// it: for the SAME (org, investor, level) pair, a repeat request never
// re-attempts the task insert below, even after whatever made it fail the
// first time (e.g. migration 0132 not applied yet) is fixed. The gap
// self-heals for NEW pairs requesting level 3 after that point, not for
// one that already got stuck — see the task-insert's own comment for why
// that's an accepted trade, not treated as a bug to route around here.
export async function requestInterestLevel(
  admin: SupabaseClient, opts: { orgId: string; investorCatalogEntityId: string; level: 2 | 3; userId: string },
): Promise<{ error: { message: string } | null }> {
  const { data: existing } = await admin.from('investor_interest_levels').select('id')
    .eq('org_id', opts.orgId).eq('investor_catalog_entity_id', opts.investorCatalogEntityId).eq('level', opts.level).maybeSingle();
  if (existing) return { error: null };

  if (opts.level === 2) {
    const { error } = await admin.from('investor_interest_levels').insert({
      org_id: opts.orgId, investor_catalog_entity_id: opts.investorCatalogEntityId, level: 2,
      status: 'granted', requested_by: opts.userId, decided_by: opts.userId, decided_at: new Date().toISOString(),
    });
    return { error };
  }

  const { error } = await admin.from('investor_interest_levels').insert({
    org_id: opts.orgId, investor_catalog_entity_id: opts.investorCatalogEntityId, level: 3,
    status: 'pending', requested_by: opts.userId,
  });
  if (error) return { error };

  // Best-effort founder-side task, same posture as every other notify path
  // in this codebase (never undoes the request itself on failure). Linked
  // to the founder's own CRM entity (via catalog_deliveries, the same
  // linking table matchdeal_record_interest_notification itself uses) so
  // decideInterestLevel3 below can close it again once decided.
  //
  // Bug fix (relatorio_verificacao_..._8143c75_p136 §6) — this used to fall
  // back to inserting an UNTAGGED task (source omitted) when the tagged
  // insert failed (e.g. migration 0132's tasks_source widening not applied
  // yet). decideInterestLevel3 only ever closes tasks matching
  // source='interest_level_request', so that fallback task could never be
  // found again and stayed on the founder's Today forever. No fallback:
  // if the tagged insert fails, log it and create nothing. (Corrected
  // 2026-08-06: a missing task here is a visible gap that self-heals for
  // the NEXT NEW (org, investor, level) request once 0132 lands — not for
  // this same one, since the idempotency early-return above skips the
  // whole insert path on any repeat. Still the accepted trade: a gap that
  // heals eventually for new requests beats one that heals never.)
  //
  // Second bug fix, same relatório (§3) — catalog_deliveries can have no
  // row at all for this (org, investor) pair (measured live: 0% coverage
  // for two of four orgs with any pipeline activity), which used to insert
  // the task with entity_id = null. decideInterestLevel3 only closes tasks
  // by matching entity_id to what catalog_deliveries resolves AT DECISION
  // TIME — a null entity_id can never match that filter, so the task
  // could never close, regardless of source tagging. Same fix as above,
  // applied to the second way this exact class of bug reaches the same
  // outcome: no entity to link to means no task, not an unlinkable one.
  // The request itself is never invisible either way — the founder's own
  // "Contact requests" card (InterestLevelRequestsCard) reads
  // investor_interest_levels directly, not tasks.
  const [{ data: catalogEntity }, { data: delivery }] = await Promise.all([
    admin.from('catalog_entities').select('name').eq('id', opts.investorCatalogEntityId).maybeSingle(),
    admin.from('catalog_deliveries').select('entity_id').eq('org_id', opts.orgId).eq('catalog_id', opts.investorCatalogEntityId).maybeSingle(),
  ]);
  const entityId = (delivery?.entity_id as string | undefined) ?? null;
  if (!entityId) {
    console.error('interest_level_request task skipped — no catalog_deliveries entity_id for this (org, investor) pair yet');
    return { error: null };
  }
  const title = `${catalogEntity?.name ?? 'An investor'} requested contact access`;
  const { error: taskError } = await admin.from('tasks').insert({
    org_id: opts.orgId, title, due_at: new Date().toISOString(), entity_id: entityId,
    kind: 'follow_up', action_type: 'follow_up_thread', source: 'interest_level_request',
  });
  if (taskError) console.error('interest_level_request task insert failed (migration 0132 applied?)', taskError);
  return { error: null };
}

export async function decideInterestLevel3(
  admin: SupabaseClient, opts: { id: string; orgId: string; decidedBy: string; decision: 'granted' | 'denied'; note?: string | null; shareDirectEmail: boolean },
): Promise<{ error: { message: string } | null }> {
  const { data: row, error } = await admin.from('investor_interest_levels').update({
    status: opts.decision, decided_by: opts.decidedBy, decided_at: new Date().toISOString(),
    note: opts.note ?? null, share_direct_email: opts.decision === 'granted' ? opts.shareDirectEmail : false,
  }).eq('id', opts.id).eq('org_id', opts.orgId).eq('status', 'pending').select('investor_catalog_entity_id').maybeSingle();
  if (error) return { error };

  // Close the Today task this request created, either way (granted or
  // denied — the founder has acted, the task's job is done).
  if (row) {
    const { data: delivery } = await admin.from('catalog_deliveries').select('entity_id')
      .eq('org_id', opts.orgId).eq('catalog_id', row.investor_catalog_entity_id as string).maybeSingle();
    if (delivery?.entity_id) {
      await admin.from('tasks').update({ done: true })
        .eq('org_id', opts.orgId).eq('entity_id', delivery.entity_id as string).eq('source', 'interest_level_request').eq('done', false);
    }
  }
  return { error: null };
}
