// Prompt 285 §3 — cross-org fraud aggregation, called from
// /api/backoffice/fraud-flags/[id]/resolve right after a flag is resolved
// 'confirmed'. See the written proposal for the reasoning; summary:
//
// Threshold counts DISTINCT orgs with a *confirmed* flag for the same
// catalog_id — never 'pending'. The threshold aggregates human decisions
// already made (each contributing flag was individually reviewed by an
// admin), it never lets unreviewed accusations pile up into an automatic
// action on their own.
//
// At/above threshold, two things happen — confirmed by direct code
// reading that NEITHER exists today:
// (a) suspend the catalog entity — the SAME applyModerationAction state
//     machine the existing manual "suspendCatalogEntity" checkbox already
//     uses (never a second, parallel one). Idempotent: already-suspended
//     (e.g. an admin already ticked that checkbox once) is treated as
//     already-done, not an error.
// (b) block every OTHER org's existing `entities` row for this
//     catalog_id, via the catalog_deliveries join — moderation_status
//     alone has zero effect on pipelines that already have the entity
//     (confirmed by grep: no delivery-path or cross-org read of it
//     exists). Orgs that already reported it themselves are already
//     resolved_blocked with hard_filter_block_source='self_report' and
//     are left untouched; only orgs that never reported anything get
//     hard_filter_block_source='platform_action' here, so
//     HardFilterBanner can tell the two apart.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyModerationAction } from './moderation-actions';

export const CROSS_ORG_FRAUD_THRESHOLD = 3;

export interface CrossOrgFraudThresholdResult {
  triggered: boolean;
  confirmedOrgCount: number;
  blockedEntityCount: number;
  error?: string;
}

export async function applyCrossOrgFraudThresholdIfReached(
  admin: SupabaseClient,
  params: { catalogId: string; actorId: string },
): Promise<CrossOrgFraudThresholdResult> {
  const { catalogId, actorId } = params;

  const { data: confirmedFlags, error: countErr } = await admin
    .from('entity_fraud_flags')
    .select('org_id')
    .eq('catalog_id', catalogId)
    .eq('status', 'actioned')
    .eq('outcome', 'confirmed');
  if (countErr) return { triggered: false, confirmedOrgCount: 0, blockedEntityCount: 0, error: countErr.message };

  const confirmedOrgIds = Array.from(new Set((confirmedFlags ?? []).map((f) => f.org_id as string)));
  if (confirmedOrgIds.length < CROSS_ORG_FRAUD_THRESHOLD) {
    return { triggered: false, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0 };
  }

  // (a) — idempotent: skip if some earlier action already suspended/deleted it.
  const { data: catalogRow, error: catalogErr } = await admin
    .from('catalog_entities').select('moderation_status').eq('id', catalogId).maybeSingle();
  if (catalogErr) return { triggered: false, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0, error: catalogErr.message };
  if (catalogRow && catalogRow.moderation_status !== 'suspended' && catalogRow.moderation_status !== 'deleted') {
    const result = await applyModerationAction(admin, {
      targetType: 'investor', targetId: catalogId, action: 'suspend', actorId,
      justification: `Automatic — ${confirmedOrgIds.length} independent orgs confirmed fraud/scam reports for this catalog entity.`,
    });
    if (!result.ok) return { triggered: false, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0, error: result.error };
  }

  // (b) — every org's existing entities row linked to this catalog_id via
  // catalog_deliveries, except ones already resolved_blocked (either
  // self-reported already, or a prior threshold run already covered
  // them) or resolved_not_a_fit (that org's own separate, unrelated call —
  // never overwritten by this).
  const { data: deliveries, error: delErr } = await admin
    .from('catalog_deliveries').select('entity_id').eq('catalog_id', catalogId).not('entity_id', 'is', null);
  if (delErr) return { triggered: true, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0, error: delErr.message };

  const entityIds = Array.from(new Set((deliveries ?? []).map((d) => d.entity_id as string).filter(Boolean)));
  if (!entityIds.length) return { triggered: true, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0 };

  const { data: targetEntities, error: entitiesErr } = await admin
    .from('entities').select('id, hard_filter_status').in('id', entityIds);
  if (entitiesErr) return { triggered: true, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0, error: entitiesErr.message };

  const toBlock = (targetEntities ?? [])
    .filter((e) => e.hard_filter_status !== 'resolved_blocked' && e.hard_filter_status !== 'resolved_not_a_fit')
    .map((e) => e.id as string);
  if (!toBlock.length) return { triggered: true, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0 };

  const now = new Date().toISOString();
  const { error: updateErr } = await admin.from('entities').update({
    hard_filter_status: 'resolved_blocked', hard_filter_resolved_at: now,
    hard_filter_resolved_by: actorId, hard_filter_block_source: 'platform_action',
  }).in('id', toBlock);
  if (updateErr) return { triggered: true, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: 0, error: updateErr.message };

  return { triggered: true, confirmedOrgCount: confirmedOrgIds.length, blockedEntityCount: toBlock.length };
}
