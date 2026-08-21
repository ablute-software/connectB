// Prompt 277 A — founder-facing "Report — suspected fraud/scam". Modeled
// on /api/entities/[id]/enrich's own auth pattern (session + explicit
// org_members check, not implicit RLS alone — "nunca só UI"): any org
// member may report their own org's entity, no platform-admin gate.
//
// Two writes, both server-side (never split across a store action + this
// route, so a serious report can't half-land): the entity_fraud_flags row
// (evidence + justification, migration 0196) for platform review, and the
// entities.hard_filter_status flip to 'resolved_blocked' + audit columns
// — the exact same status HardFilterBanner already reads, so the founder
// sees "Reported — pending review" immediately, no separate sync step.
// Never writes directly to catalog_entities or calls applyModerationAction
// — this only ever REPORTS; confirming/dismissing and any platform-wide
// action is the backoffice review queue's job alone (see
// /api/backoffice/fraud-flags), matching "só a revisão da plataforma
// decide" from the prompt itself.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { entityFraudFlagsAvailable } from '@/lib/entity-fraud-flags-capability';
import { crossOrgFraudBlockSourceAvailable } from '@/lib/cross-org-fraud-capability';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (!(await entityFraudFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { data: entity, error: entityErr } = await admin.from('entities').select('id, org_id, name').eq('id', id).maybeSingle();
  if (entityErr || !entity) return NextResponse.json({ ok: false, error: entityErr?.message ?? 'Entity not found.' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { justification?: string; evidence?: string };
  const justification = body.justification?.trim();
  const evidence = body.evidence?.trim();
  if (!justification || !evidence) {
    return NextResponse.json({ ok: false, error: 'Justification and evidence are both required.' }, { status: 400 });
  }

  // Best-effort cross-reference to the shared catalog row, if this entity
  // happens to be linked — never required, since a founder can report a
  // purely manual, never-catalogued entity too (per Nuno's own framing:
  // "pode nem ter conta").
  const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('entity_id', entity.id).maybeSingle();

  const { error: flagErr } = await admin.from('entity_fraud_flags').insert({
    entity_id: entity.id, org_id: entity.org_id, catalog_id: delivery?.catalog_id ?? null,
    justification, evidence, flagged_by: user.id,
  });
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    hard_filter_status: 'resolved_blocked', hard_filter_resolved_at: now, hard_filter_resolved_by: user.id,
  };
  // Prompt 285 §3 — distinguishes this from a future cross-org
  // platform_action block (migration 0200); only set once that column
  // actually exists, same additive-migration caution as everywhere else.
  if (await crossOrgFraudBlockSourceAvailable()) updatePayload.hard_filter_block_source = 'self_report';

  const { error: updateErr } = await admin.from('entities').update(updatePayload).eq('id', entity.id);
  if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
