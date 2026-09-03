// Investor Workspace Tools (prompt 62.6) — "what have I already reviewed"
// per data-room section. Same QA non-contamination principle as every
// other portal write route.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { PORTAL_SECTIONS } from '@/lib/dataroom-sections';
import { assertNotViewer } from '@/lib/developer-viewer';
import { activeGrantOrgIds, eligibleOrgIds } from '@/lib/portal-access';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  // BUG-SEG-2 — this route used to filter only by investor_email + the
  // caller-supplied orgId, with no check that this investor actually has an
  // active access_grants row for that org: any authenticated investor could
  // read another org's diligence-checklist state just by passing its id.
  // eligibleOrgIds (not the bare activeGrantOrgIds) so an @ablute.pt QA
  // session — which gets into the shell via is_ablute_developer(), not a
  // real grant — keeps working like every other portal route.
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(orgId)) return NextResponse.json({ error: 'No active access to this org.' }, { status: 403 });

  const { data: rows } = await admin.from('investor_diligence_checklist').select('section_key, reviewed, reviewed_at')
    .eq('org_id', orgId).eq('investor_email', email);
  const rowByKey = new Map((rows ?? []).map((r) => [r.section_key as string, r]));

  const sections = PORTAL_SECTIONS.map((s) => ({
    key: s.key, label: s.label,
    reviewed: rowByKey.get(s.key)?.reviewed ?? false,
    reviewedAt: rowByKey.get(s.key)?.reviewed_at ?? null,
  }));
  return NextResponse.json({ sections });
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

  const body = await req.json().catch(() => ({})) as { orgId?: string; sectionKey?: string; reviewed?: boolean };
  if (!body.orgId || !body.sectionKey || typeof body.reviewed !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'orgId, sectionKey, and reviewed are required.' }, { status: 400 });
  }
  if (!PORTAL_SECTIONS.some((s) => s.key === body.sectionKey)) {
    return NextResponse.json({ ok: false, error: 'Unknown section.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;
  // BUG-SEG-2 — same missing-grant-check as GET, for the write side: an
  // authenticated investor could otherwise mark checklist sections
  // reviewed/unreviewed against an org they have no access to.
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await activeGrantOrgIds(admin, email, person?.id ?? null);
  if (!orgIds.includes(body.orgId)) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });

  const { error } = await admin.from('investor_diligence_checklist').upsert(
    { org_id: body.orgId, investor_email: email, section_key: body.sectionKey, reviewed: body.reviewed, reviewed_at: body.reviewed ? new Date().toISOString() : null },
    { onConflict: 'org_id,investor_email,section_key' },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
