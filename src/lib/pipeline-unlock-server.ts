// Prompt 123 Block B.2/C.1 — real-data gathering for the pipeline-unlock
// formula, factored out of /api/pipeline-unlock/route.ts so the Backoffice
// Startups table (Block C.1's "Size of Visible Pipeline" column) can reuse
// the exact same computation per org instead of recalculating it separately
// (the prompt's own instruction: "reutilizar a mesma função, nunca
// recalcular à parte").
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  visiblePipelineSize, isProfileGateComplete, hasDocumentForBonus, completeMonthsSince,
  DECK_BONUS_FOLDERS, DECK_BONUS_KEYWORDS, BUSINESS_PLAN_BONUS_FOLDERS, BUSINESS_PLAN_BONUS_KEYWORDS,
  type PipelineUnlockInput,
} from './pipeline-unlock';
import { PRESET_FOLDER_NAMES, PRESET_FOLDER_COUNT } from './vault-preset-folders';
import { normalizePlan } from './plans';

// Prompt 180 — the ONE place that gathers the real, per-org inputs the
// pipeline-unlock formula runs on. Reused by computeVisiblePipelineSize
// below for BOTH of its outputs: `visible` (the "N of M eligible investors
// unlocked" badge — capped by the real eligible pool) and
// `catalogQuotaTarget` (the RLS-enforced delivery ceiling's target —
// uncapped, "aqui queremos o alvo, não o já-entregue": the pool cap belongs
// to unlockPack/catalog_top_matches's own delivery step, not to how big the
// ceiling is allowed to grow). One calculation site, two derived numbers —
// per the prompt's own instruction not to invent a second place this gets
// computed.
async function gatherPipelineUnlockInputs(
  admin: SupabaseClient, orgId: string,
): Promise<{ input: Omit<PipelineUnlockInput, 'eligiblePoolSize'>; eligiblePoolSize: number } | null> {
  const [{ data: org }, { data: folders }, { data: documents }, { count: eligiblePoolSize }, { data: entities }] = await Promise.all([
    admin.from('orgs').select('*').eq('id', orgId).maybeSingle(),
    admin.from('folders').select('id, name').eq('org_id', orgId),
    admin.from('documents').select('name, folder_id').eq('org_id', orgId),
    admin.from('entities').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('entities').select('id, source').eq('org_id', orgId),
  ]);
  if (!org) return null;

  const entityIds = (entities ?? []).map((e) => e.id as string);
  const firstManualAddLogged = (entities ?? []).some((e) => e.source === 'manual');

  let firstOutboundLogged = false;
  let firstInboundLogged = false;
  if (entityIds.length > 0) {
    const [{ data: outRows }, { data: inRows }] = await Promise.all([
      admin.from('interactions').select('id').in('entity_id', entityIds).eq('direction', 'out').limit(1),
      admin.from('interactions').select('id').in('entity_id', entityIds).eq('direction', 'in').limit(1),
    ]);
    firstOutboundLogged = (outRows?.length ?? 0) > 0;
    firstInboundLogged = (inRows?.length ?? 0) > 0;
  }

  const folderByName = new Map((folders ?? []).map((f) => [f.name as string, f.id as string]));
  const presetFolderIds = PRESET_FOLDER_NAMES.map((name) => folderByName.get(name)).filter(Boolean) as string[];
  const foldersWithDoc = new Set((documents ?? []).filter((d) => d.folder_id).map((d) => d.folder_id as string));
  const presetFoldersWithFile = presetFolderIds.filter((id) => foldersWithDoc.has(id)).length;

  // Prompt 536 §4 — the bonus now reads the folder the file sits in, with
  // the old filename match kept as a fallback (see hasDocumentForBonus).
  // folderNameById is built from the same `folders` read already in flight
  // above; no extra query.
  const folderNameById = new Map((folders ?? []).map((f) => [f.id as string, f.name as string]));
  const docsForBonus = (documents ?? []).map((d) => ({
    name: d.name as string,
    folderName: d.folder_id ? folderNameById.get(d.folder_id as string) ?? null : null,
  }));

  const investorDeckUploaded = hasDocumentForBonus(docsForBonus, DECK_BONUS_FOLDERS, DECK_BONUS_KEYWORDS);
  const businessPlanUploaded = hasDocumentForBonus(docsForBonus, BUSINESS_PLAN_BONUS_FOLDERS, BUSINESS_PLAN_BONUS_KEYWORDS);
  const gateComplete = isProfileGateComplete(org);
  const profileCompletedAt = (org.profile_completed_at as string | null) ?? null;
  const months = profileCompletedAt ? completeMonthsSince(profileCompletedAt, new Date().toISOString()) : 0;

  return {
    input: {
      planTier: normalizePlan(org.plan as string | null),
      profileGateComplete: gateComplete,
      investorDeckUploaded,
      businessPlanUploaded,
      presetFoldersWithFile,
      presetFolderCount: PRESET_FOLDER_COUNT,
      firstOutboundLogged,
      firstInboundLogged,
      firstManualAddLogged,
      completeMonthsSinceUnlock: months,
    },
    eligiblePoolSize: eligiblePoolSize ?? 0,
  };
}

export async function computeVisiblePipelineSize(
  admin: SupabaseClient, orgId: string,
): Promise<{ visible: number; gateComplete: boolean; eligiblePoolSize: number; catalogQuotaTarget: number }> {
  const gathered = await gatherPipelineUnlockInputs(admin, orgId);
  if (!gathered) return { visible: 0, gateComplete: false, eligiblePoolSize: 0, catalogQuotaTarget: 0 };
  const { input, eligiblePoolSize } = gathered;
  const visible = visiblePipelineSize({ ...input, eligiblePoolSize });
  // Same formula, uncapped — see the header comment above.
  const catalogQuotaTarget = visiblePipelineSize({ ...input, eligiblePoolSize: Number.MAX_SAFE_INTEGER });
  return { visible, gateComplete: input.profileGateComplete, eligiblePoolSize, catalogQuotaTarget };
}

// Prompt 579 — catalog_effective_quota()'s is_ablute_developer() bypass
// (migration 0166) returns 999999 as an internal "unlimited" contract value.
// It is never a real supply number: production served "999989 more matched
// investors ready for you" to sherlockdeal.com@gmail.com the moment 0317
// (the explicit platform_admins roster) made that account pass
// is_ablute_developer() too, ten real deliveries into a catalog that holds
// ~760 rows total. This is the one place quota becomes a number honest
// enough to show or to deliver — capped at whatever catalog_top_matches
// actually has left for this org, the SAME RPC deliverCatalogMatches
// (catalog-delivery-core.ts) calls for a real delivery and
// catalog_outreach_supply (migration 0303) is built on for the cross-org
// view. Never a second eligibility rule invented here.
export const UNLIMITED_QUOTA_SENTINEL = 999999;

// The whole catalog is ~760 rows today; this is a generous, fixed ceiling on
// "give me everything catalog_top_matches has for this org," not a page
// size. catalog_blocked_count (migration 0166) already establishes the
// identical pattern (count(*) from catalog_entities as its own p_limit) for
// the same reason: the WHERE clause is what bounds the real answer — this
// number only has to not be the thing that cuts it short.
const ELIGIBLE_SUPPLY_SCAN_LIMIT = 5000;

// Both callers need the same number: /api/pipeline-unlock (GET) displays it
// as "N more matched investors", /api/pipeline-unlock/deliver (POST) passes
// it to deliverCatalogMatches as p_limit. One function, so the banner can
// never promise more than the button can deliver.
export async function computeDeliverable(
  admin: SupabaseClient, orgId: string, quota: number, deliveredCount: number,
): Promise<{ deliverable: number; unlimited: boolean }> {
  const unlimited = quota >= UNLIMITED_QUOTA_SENTINEL;
  const { data: matches } = await admin.rpc('catalog_top_matches', { p_org_id: orgId, p_limit: ELIGIBLE_SUPPLY_SCAN_LIMIT });
  const realEligibleSupply = matches?.length ?? 0;
  if (unlimited) return { deliverable: realEligibleSupply, unlimited: true };
  const remainingQuota = Math.max(0, quota - deliveredCount);
  return { deliverable: Math.min(remainingQuota, realEligibleSupply), unlimited: false };
}

// Prompt 180 — raises orgs.catalog_quota to `target` if (and only if) it's
// currently lower. Never lowers it — same "accumulating counter" contract
// migration 0149 already established for this column (an org never loses
// entities it already unlocked). Called from every point that already
// recomputes the pipeline-unlock formula for real (see
// /api/pipeline-unlock/route.ts and plan-sync.ts) rather than on a timer —
// the monthly cron (catalog-monthly-delivery.ts, Prompt 179 §B) is the only
// TIME-based grower; this is the EVENT-based one (profile gate completing,
// a bonus-earning upload/action, a plan change).
export async function raiseCatalogQuotaFloor(admin: SupabaseClient, orgId: string, target: number): Promise<void> {
  if (target <= 0) return;
  const { data: org } = await admin.from('orgs').select('catalog_quota').eq('id', orgId).maybeSingle();
  if (org && (org.catalog_quota ?? 0) < target) {
    await admin.from('orgs').update({ catalog_quota: target }).eq('id', orgId);
  }
}
