// Prompt 349 — Chamber 2: an investor's explicit, item-by-item opt-in share
// of ONE Watson insight with the founder. Identified (the investor's own
// name), never anonymous. The client shows the exact text before this POST
// fires — this route persists exactly what it's given, no re-generation, no
// editing server-side.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { assertNotViewer } from '@/lib/developer-viewer';

const VALID_KINDS = ['reading', 'threshold_suggestion', 'alert_reason'];

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'Not available yet.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string; kind?: string; text?: string };
  const { orgId, kind, text } = body;
  if (!orgId || !kind || !text) return NextResponse.json({ ok: false, error: 'orgId, kind and text are required.' }, { status: 400 });
  if (!VALID_KINDS.includes(kind)) return NextResponse.json({ ok: false, error: 'Invalid kind.' }, { status: 400 });
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) return NextResponse.json({ ok: false, error: 'Empty text.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No linked investor organization.' }, { status: 403 });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(orgId)) return NextResponse.json({ ok: false, error: 'This startup is not in your Pipeline.' }, { status: 403 });

  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', investorCatalogEntityId).maybeSingle();
  const { error } = await admin.from('investor_feedback_shares').insert({
    org_id: orgId, investor_catalog_entity_id: investorCatalogEntityId,
    investor_name: (entity?.name as string | undefined) ?? 'An investor', kind, text: trimmed,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
