// P136 — investor side of the disclosure ladder. GET returns the current
// level plus this firm's own row history (both the investor and the
// founder read the SAME rows — "registado para os dois lados" comes free
// from that, per the mini-prompt's own §8). POST requests a step up:
// level 2 is granted instantly, level 3 always lands as 'pending' for the
// founder to decide.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { interestLevelAvailable } from '@/lib/investor-interest-level-capability';
import { currentInterestLevel } from '@/lib/investor-interest-level';
import { getInterestLevelRows, requestInterestLevel, toInvestorFacingLevelRows } from '@/lib/investor-interest-level-db';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ level: 0, rows: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  if (!(await interestLevelAvailable())) return NextResponse.json({ level: 0, rows: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const eligibleOrgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!eligibleOrgIds.includes(orgId)) return NextResponse.json({ error: 'Not eligible for this startup.' }, { status: 403 });

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ level: 0, rows: [] });

  const { data: decision } = await admin.from('investor_relationship_decisions').select('decision')
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  const rows = await getInterestLevelRows(admin, orgId, investorCatalogEntityId);
  const level = currentInterestLevel((decision?.decision as 'interested' | 'passed' | undefined) ?? null, rows);

  // Bug fix (relatorio_verificacao_..._8143c75_p136 §3) — see the same fix
  // in /api/portal/startup/[orgId]: `rows` used to include the founder's
  // own private `note`. toInvestorFacingLevelRows strips it to {level, status}.
  return NextResponse.json({ level, rows: toInvestorFacingLevelRows(rows) });
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

  if (!(await interestLevelAvailable())) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as { orgId?: string; level?: number };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (body.level !== 2 && body.level !== 3) return NextResponse.json({ ok: false, error: 'level must be 2 or 3.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const eligibleOrgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!eligibleOrgIds.includes(body.orgId)) return NextResponse.json({ ok: false, error: 'Not eligible for this startup.' }, { status: 403 });

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const { data: decision } = await admin.from('investor_relationship_decisions').select('decision')
    .eq('org_id', body.orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  const rows = await getInterestLevelRows(admin, body.orgId, investorCatalogEntityId);
  const currentLevel = currentInterestLevel((decision?.decision as 'interested' | 'passed' | undefined) ?? null, rows);

  // A passed relationship stays collapsed at 0 — no requesting anything.
  // Requesting level 2 requires already being at level 1 (interested);
  // requesting level 3 requires already being at level 2.
  if (decision?.decision === 'passed') return NextResponse.json({ ok: false, error: 'This relationship has been passed.' }, { status: 403 });
  if (body.level === 2 && currentLevel < 1) return NextResponse.json({ ok: false, error: 'Express interest first.' }, { status: 403 });
  if (body.level === 3 && currentLevel < 2) return NextResponse.json({ ok: false, error: 'Request the full profile first.' }, { status: 403 });

  const { error } = await requestInterestLevel(admin, { orgId: body.orgId, investorCatalogEntityId, level: body.level, userId: user.id });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
