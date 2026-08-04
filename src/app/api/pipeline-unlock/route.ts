// Prompt 123 Block B.2 — real-data wiring for the pipeline-unlock engine.
// Gathers the actual inputs (profile gate fields, deck/business-plan
// presence, preset-folder file counts, outbound/inbound/manual-add
// milestones, months since unlock) and calls the pure formula in
// pipeline-unlock.ts. Read-only except for one idempotent, system-derived
// stamp (profile_completed_at, the first time the gate passes) — guarded by
// assertNotViewer so a developer viewing a startup read-only never
// triggers it.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer, readViewerOrgId } from '@/lib/developer-viewer';
import {
  visiblePipelineSize, isProfileGateComplete, hasAnyDocumentNamed, completeMonthsSince,
} from '@/lib/pipeline-unlock';
import { PRESET_FOLDER_NAMES, PRESET_FOLDER_COUNT } from '@/lib/vault-preset-folders';
import { normalizePlan } from '@/lib/plans';
import { pipelineUnlockAnchorsAvailable } from '@/lib/pipeline-unlock-capability';

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Developer Viewer reads the viewed org, same override store-supabase.tsx
  // already applies for the rest of the workspace.
  let orgId = readViewerOrgId(req);
  if (!orgId) {
    const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
    orgId = member?.org_id ?? null;
  }
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const anchorsAvailable = await pipelineUnlockAnchorsAvailable();

  const [{ data: org }, { data: folders }, { data: documents }, { count: eligiblePoolSize }, { data: entities }] = await Promise.all([
    admin.from('orgs').select('*').eq('id', orgId).maybeSingle(),
    admin.from('folders').select('id, name').eq('org_id', orgId),
    admin.from('documents').select('name, folder_id').eq('org_id', orgId),
    admin.from('entities').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('entities').select('id, source').eq('org_id', orgId),
  ]);

  if (!org) return NextResponse.json({ ok: false, error: 'Org not found.' }, { status: 404 });

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

  // First-time stamp — idempotent (written once, only when the gate just
  // became true), never fired inside an active Developer Viewer session.
  let profileCompletedAt: string | null = anchorsAvailable ? (org.profile_completed_at ?? null) : null;
  if (anchorsAvailable && gateComplete && !profileCompletedAt) {
    const viewerBlock = await assertNotViewer(sb, req);
    if (!viewerBlock) {
      const now = new Date().toISOString();
      await admin.from('orgs').update({ profile_completed_at: now }).eq('id', orgId);
      profileCompletedAt = now;
    }
  }

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

  return NextResponse.json({
    ok: true,
    gateComplete,
    visible,
    eligiblePoolSize: eligiblePoolSize ?? 0,
    anchorsAvailable,
    breakdown: {
      investorDeckUploaded, businessPlanUploaded, presetFoldersWithFile, presetFolderCount: PRESET_FOLDER_COUNT,
      firstOutboundLogged, firstInboundLogged, firstManualAddLogged, completeMonthsSinceUnlock: months,
    },
  });
}
