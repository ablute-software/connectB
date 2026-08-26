// Prompt 394 §4.4/§4.5 — list this investor's own past Watson readings for
// one startup: the date of the last one (for §4.3's "open that one, or ask
// for a new opinion?" popup) and the full list (for §4.5's "History" view
// inside the results modal). Same access-scoping as evaluation-support's
// own route: this startup must be in the caller's Pipeline, and the
// history itself is scoped to `resolveActiveInvestorMember`'s own
// investor_member_id — never a colleague at the same fund, never the
// founder (watson_evaluation_readings carries no RLS policy for any client
// role at all; this route's own service-role query is the only path to it).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'Not available yet.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No linked investor organization.' }, { status: 403 });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(orgId)) return NextResponse.json({ ok: false, error: 'This startup is not in your Pipeline.' }, { status: 403 });

  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: true, readings: [] });

  const { data, error } = await admin.from('watson_evaluation_readings')
    .select('id, insights, created_at').eq('org_id', orgId).eq('investor_member_id', member.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, readings: data ?? [] });
}
