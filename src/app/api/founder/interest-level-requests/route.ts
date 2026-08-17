// P136 — founder side of the disclosure ladder. GET lists this org's
// level-3 requests (pending + already-decided, newest first); POST
// approves or denies one. Same service-role-only pattern as
// investor_interest_levels' own zero-policy RLS.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { interestLevelAvailable } from '@/lib/investor-interest-level-capability';
import { decideInterestLevel3 } from '@/lib/investor-interest-level-db';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ requests: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await interestLevelAvailable())) return NextResponse.json({ requests: [] });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ requests: [] });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: rows } = await admin.from('investor_interest_levels')
    .select('id, investor_catalog_entity_id, status, requested_at, decided_at, note, share_direct_email')
    .eq('org_id', orgId).eq('level', 3).order('requested_at', { ascending: false });
  if (!rows || rows.length === 0) return NextResponse.json({ requests: [] });

  const catalogIds = [...new Set(rows.map((r) => r.investor_catalog_entity_id as string))];
  // Prompt 220 §A-§C — entityId (the org's own CRM entity for this investor,
  // via catalog_deliveries — the same resolution the Today task uses at
  // creation and decision time) lets Today and the entity page match a
  // request to their task/entity. Founder's own org data, nothing crosses
  // the tenant boundary.
  const [{ data: catalogEntities }, { data: deliveries }] = await Promise.all([
    admin.from('catalog_entities').select('id, name').in('id', catalogIds),
    admin.from('catalog_deliveries').select('catalog_id, entity_id').eq('org_id', orgId).in('catalog_id', catalogIds),
  ]);
  const nameById = new Map((catalogEntities ?? []).map((c) => [c.id as string, c.name as string]));
  const entityByCatalogId = new Map((deliveries ?? []).map((d) => [d.catalog_id as string, d.entity_id as string | null]));

  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id, investorName: nameById.get(r.investor_catalog_entity_id as string) ?? 'Unknown investor',
      status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at, note: r.note, shareDirectEmail: r.share_direct_email,
      entityId: entityByCatalogId.get(r.investor_catalog_entity_id as string) ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await interestLevelAvailable())) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 403 });
  const orgId = member.org_id as string;

  const body = await req.json().catch(() => ({})) as { id?: string; decision?: 'granted' | 'denied'; note?: string; shareDirectEmail?: boolean };
  if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
  if (body.decision !== 'granted' && body.decision !== 'denied') return NextResponse.json({ ok: false, error: 'decision must be granted or denied.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await decideInterestLevel3(admin, {
    id: body.id, orgId, decidedBy: user.id, decision: body.decision, note: body.note ?? null, shareDirectEmail: !!body.shareDirectEmail,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
