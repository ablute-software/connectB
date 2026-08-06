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

// Level 2 — frictionless: granted the instant it's asked for (§3 of
// prompt_136 — the gate isn't the point, the signal is). Level 3 — always
// created as 'pending'; the founder decides via decideLevel3 below.
// Idempotent per (org, investor, level) via the unique constraint — a
// second request when a row already exists just returns the existing one
// unchanged, never a duplicate or a silent overwrite of a founder's denial.
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
  // decideInterestLevel3 below can close it again once decided. Falls back
  // to an untagged, unlinked task if migration 0132 (the tasks_source
  // widening) hasn't landed yet, rather than silently creating nothing.
  const [{ data: catalogEntity }, { data: delivery }] = await Promise.all([
    admin.from('catalog_entities').select('name').eq('id', opts.investorCatalogEntityId).maybeSingle(),
    admin.from('catalog_deliveries').select('entity_id').eq('org_id', opts.orgId).eq('catalog_id', opts.investorCatalogEntityId).maybeSingle(),
  ]);
  const title = `${catalogEntity?.name ?? 'An investor'} requested contact access`;
  const entityId = (delivery?.entity_id as string | undefined) ?? null;
  const { error: taskError } = await admin.from('tasks').insert({
    org_id: opts.orgId, title, due_at: new Date().toISOString(), entity_id: entityId,
    kind: 'follow_up', action_type: 'follow_up_thread', source: 'interest_level_request',
  });
  if (taskError) {
    await admin.from('tasks').insert({ org_id: opts.orgId, title, due_at: new Date().toISOString(), entity_id: entityId, kind: 'follow_up', action_type: 'follow_up_thread' })
      .then(() => {}, () => {});
  }
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
