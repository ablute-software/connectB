// Prompt 123 Block B.2 — real-data wiring for the pipeline-unlock engine.
// The actual formula-input gathering + calculation lives in
// pipeline-unlock-server.ts (shared with the Backoffice Startups table,
// Block C.1, so both surfaces read the exact same number). This route's own
// job is just the one write side-effect: an idempotent, system-derived
// profile_completed_at stamp the first time the B.2 gate passes — guarded
// by assertNotViewer so a developer viewing a startup read-only never
// triggers it.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer, readViewerOrgId } from '@/lib/developer-viewer';
import { isProfileGateComplete } from '@/lib/pipeline-unlock';
import { computeVisiblePipelineSize } from '@/lib/pipeline-unlock-server';
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
  if (anchorsAvailable) {
    const { data: org } = await admin.from('orgs').select('*').eq('id', orgId).maybeSingle();
    if (org && isProfileGateComplete(org) && !org.profile_completed_at) {
      const viewerBlock = await assertNotViewer(sb, req);
      if (!viewerBlock) await admin.from('orgs').update({ profile_completed_at: new Date().toISOString() }).eq('id', orgId);
    }
  }

  const { visible, gateComplete, eligiblePoolSize } = await computeVisiblePipelineSize(admin, orgId);
  return NextResponse.json({ ok: true, gateComplete, visible, eligiblePoolSize, anchorsAvailable });
}
