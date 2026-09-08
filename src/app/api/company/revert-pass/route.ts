// Prompt 853 §2 — the write path for reverting an investor-side pass that
// closed a relationship (entities.status: 'passed' + relationship_state.
// stage: 'decision', written by RelationshipSummaryCard's "No interest /
// over"). Same gate as /api/company/investor-decisions: `investor_decisions`
// (org-permissions.ts), checked with canWithMatrix.
//
// Restores exactly what the pass interaction itself recorded at save time —
// previous_status/previous_stage (migration 0341) — never a guess. It does
// NOT touch tasks (planPass closed them with "closed — passed"; a revert
// leaves them closed, a founder who wants them back reopens them) and does
// NOT touch reopen_trigger (the founder's own note, still useful).
//
// The interaction row is never deleted: reverted_at/reverted_by mark it
// superseded, exactly like startup_investor_decisions' own pair, so the
// back-office "Passes / Over" tab (852 §F) can show it struck through
// rather than losing it.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { canWithMatrix } from '@/lib/org-permissions';
import { loadOrgMatrix } from '@/lib/org-matrix-server';
import type { OrgRole } from '@/lib/permissions';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { interactionId?: string };
  const interactionId = body.interactionId;
  if (!interactionId) return NextResponse.json({ ok: false, error: 'interactionId is required.' }, { status: 400 });

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const matrix = await loadOrgMatrix(admin, member.org_id as string);
  if (!canWithMatrix(matrix, member.role as OrgRole, 'investor_decisions')) {
    return NextResponse.json({ ok: false, error: 'Your role can’t revert this decision.' }, { status: 403 });
  }

  const { data: row } = await admin.from('interactions')
    .select('id, org_id, entity_id, classification, previous_status, previous_stage, reverted_at')
    .eq('id', interactionId).maybeSingle();
  if (!row || row.org_id !== member.org_id) return NextResponse.json({ ok: false, error: 'Interaction not found.' }, { status: 404 });
  if (row.classification !== 'pass') return NextResponse.json({ ok: false, error: 'Not a pass.' }, { status: 400 });
  // Idempotent, same pattern as /api/company/investor-decisions: a
  // double-click or a stale tab re-sending the same revert is a no-op, not
  // an error.
  if (row.reverted_at) return NextResponse.json({ ok: true, alreadyReverted: true });
  // Do not guess: a pass whose previous_status was never recorded (it
  // predates migration 0341, or came from a different origin than the
  // pass-and-close flow) cannot be reverted. The UI is expected to hide the
  // control in that case; this is the backstop.
  if (row.previous_status == null) {
    return NextResponse.json({ ok: false, error: 'Nothing recorded to restore for this pass.' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: interactionError } = await admin.from('interactions')
    .update({ reverted_at: now, reverted_by: user.id }).eq('id', row.id);
  if (interactionError) return NextResponse.json({ ok: false, error: interactionError.message }, { status: 500 });

  const { error: entityError } = await admin.from('entities')
    .update({ status: row.previous_status }).eq('id', row.entity_id).eq('org_id', member.org_id);
  if (entityError) return NextResponse.json({ ok: false, error: entityError.message }, { status: 500 });

  if (row.previous_stage) {
    const { error: stageError } = await admin.from('relationship_state')
      .upsert({ org_id: member.org_id, entity_id: row.entity_id, stage: row.previous_stage, updated_at: now },
        { onConflict: 'org_id,entity_id' });
    if (stageError) return NextResponse.json({ ok: false, error: stageError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
