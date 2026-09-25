// Prompt 731 §2 — the manual escape hatch for when the automatic pass
// revert has nowhere to go (previous_status was never recorded — the
// interaction predates migration 0341, or was written outside the normal
// pass-and-close flow). Same gate as /api/company/revert-pass and
// /api/company/investor-decisions: `investor_decisions` (org-permissions.ts).
//
// Deliberately narrower than the full EntityStatus enum: 'invested' has its
// own dedicated flow with side effects this must not bypass (cap table,
// etc. — see the Pipeline drag-to-invested hardening, Prompt 712), and
// 'dormant' (Frozen) already has its own park flow (revisit date, task
// rescheduling via useParkEntity) this shouldn't shortcut either. This
// route only covers the plain relationship states a founder might need to
// manually restore to when nothing else can get them there.
//
// Writes a `stage_change` interaction (same channel pipeline-drop.ts's own
// manual transitions use) before the status, so the history reads in order
// and states plainly that this was a manual override, not an automatic one.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { canWithMatrix } from '@/lib/org-permissions';
import { loadOrgMatrix } from '@/lib/org-matrix-server';
import type { OrgRole } from '@/lib/permissions';
import type { EntityStatus } from '@/lib/types';
import { MANUAL_STATUS_OVERRIDE_OPTIONS, pipelineStageLabel } from '@/lib/pipeline-taxonomy';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { entityId?: string; status?: string; reason?: string };
  const { entityId, status, reason } = body;
  if (!entityId || !status) return NextResponse.json({ ok: false, error: 'entityId and status are required.' }, { status: 400 });
  if (!MANUAL_STATUS_OVERRIDE_OPTIONS.includes(status as EntityStatus)) {
    return NextResponse.json({ ok: false, error: 'That status can’t be set manually here.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const matrix = await loadOrgMatrix(admin, member.org_id as string);
  if (!canWithMatrix(matrix, member.role as OrgRole, 'investor_decisions')) {
    return NextResponse.json({ ok: false, error: 'Your role can’t change this manually.' }, { status: 403 });
  }

  const { data: entity } = await admin.from('entities').select('id, org_id, status').eq('id', entityId).maybeSingle();
  if (!entity || entity.org_id !== member.org_id) {
    return NextResponse.json({ ok: false, error: 'Investor not found in your pipeline.' }, { status: 404 });
  }
  const newStatus = status as EntityStatus;
  const previousStatus = entity.status as EntityStatus;
  if (previousStatus === newStatus) return NextResponse.json({ ok: true, unchanged: true });

  const now = new Date().toISOString();
  const trimmedReason = reason?.trim() || '';
  const note = `${pipelineStageLabel(previousStatus)} → ${pipelineStageLabel(newStatus)} — set manually (the automatic revert had nothing recorded to restore)${trimmedReason ? `: ${trimmedReason}` : '.'}`;

  const { error: interactionError } = await admin.from('interactions').insert({
    org_id: member.org_id, entity_id: entityId, occurred_at: now,
    direction: 'out', channel: 'stage_change', content: note, author_user_id: user.id,
  });
  if (interactionError) return NextResponse.json({ ok: false, error: interactionError.message }, { status: 500 });

  const { error: entityError } = await admin.from('entities')
    .update({ status: newStatus }).eq('id', entityId).eq('org_id', member.org_id);
  if (entityError) return NextResponse.json({ ok: false, error: entityError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
