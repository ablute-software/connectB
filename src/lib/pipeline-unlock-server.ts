// Prompt 123 Block B.2/C.1 — real-data gathering for the pipeline-unlock
// formula, factored out of /api/pipeline-unlock/route.ts so the Backoffice
// Startups table (Block C.1's "Size of Visible Pipeline" column) can reuse
// the exact same computation per org instead of recalculating it separately
// (the prompt's own instruction: "reutilizar a mesma função, nunca
// recalcular à parte").
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  visiblePipelineSize, isProfileGateComplete, hasAnyDocumentNamed, completeMonthsSince,
} from './pipeline-unlock';
import { PRESET_FOLDER_NAMES, PRESET_FOLDER_COUNT } from './vault-preset-folders';
import { normalizePlan } from './plans';

export async function computeVisiblePipelineSize(admin: SupabaseClient, orgId: string): Promise<{ visible: number; gateComplete: boolean; eligiblePoolSize: number }> {
  const [{ data: org }, { data: folders }, { data: documents }, { count: eligiblePoolSize }, { data: entities }] = await Promise.all([
    admin.from('orgs').select('*').eq('id', orgId).maybeSingle(),
    admin.from('folders').select('id, name').eq('org_id', orgId),
    admin.from('documents').select('name, folder_id').eq('org_id', orgId),
    admin.from('entities').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('entities').select('id, source').eq('org_id', orgId),
  ]);
  if (!org) return { visible: 0, gateComplete: false, eligiblePoolSize: 0 };

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
  const docNames = (documents ?? []).map((d) => d.name as string);
  const foldersWithDoc = new Set((documents ?? []).filter((d) => d.folder_id).map((d) => d.folder_id as string));
  const presetFoldersWithFile = presetFolderIds.filter((id) => foldersWithDoc.has(id)).length;

  const investorDeckUploaded = hasAnyDocumentNamed(docNames, ['investor deck', 'pitch deck']);
  const businessPlanUploaded = hasAnyDocumentNamed(docNames, ['business plan']);
  const gateComplete = isProfileGateComplete(org);
  const profileCompletedAt = (org.profile_completed_at as string | null) ?? null;
  const months = profileCompletedAt ? completeMonthsSince(profileCompletedAt, new Date().toISOString()) : 0;

  const visible = visiblePipelineSize({
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
    eligiblePoolSize: eligiblePoolSize ?? 0,
  });

  return { visible, gateComplete, eligiblePoolSize: eligiblePoolSize ?? 0 };
}
