// P133 (item 10) — investor-side interaction log. GET returns the unified
// timeline for one startup (manual entries + automatic decision/archive/
// MatchDeal entries); POST records a manual entry. Founder has no route
// that reads investor_interaction_log — this is the only place it's ever
// queried, and only ever with the service-role client.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { interactionLogAvailable } from '@/lib/investor-interaction-log-capability';
import { getInteractionTimeline, createManualInteractionEntry } from '@/lib/investor-interaction-log';
import { assertNotViewer } from '@/lib/developer-viewer';

const CHANNELS = ['matchdeal', 'email', 'call', 'meeting', 'message', 'other'] as const;

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ entries: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  if (!(await interactionLogAvailable())) return NextResponse.json({ entries: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const eligibleOrgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!eligibleOrgIds.includes(orgId)) return NextResponse.json({ error: 'Not eligible for this startup.' }, { status: 403 });

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ entries: [] });

  const entries = await getInteractionTimeline(admin, { investorCatalogEntityId, email, orgId });
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  if (!(await interactionLogAvailable())) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as {
    orgId?: string; channel?: string; content?: string; links?: unknown; occurredAt?: string;
  };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!body.channel || !(CHANNELS as readonly string[]).includes(body.channel)) {
    return NextResponse.json({ ok: false, error: 'A valid channel is required.' }, { status: 400 });
  }
  if (!body.content?.trim()) return NextResponse.json({ ok: false, error: 'Content is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const eligibleOrgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!eligibleOrgIds.includes(body.orgId)) return NextResponse.json({ ok: false, error: 'Not eligible for this startup.' }, { status: 403 });

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const { error } = await createManualInteractionEntry(admin, {
    investorCatalogEntityId, orgId: body.orgId, userId: user.id, channel: body.channel, content: body.content, links: body.links, occurredAt: body.occurredAt,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
