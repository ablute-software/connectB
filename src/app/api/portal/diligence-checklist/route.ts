// Investor Workspace Tools (prompt 62.6) — "what have I already reviewed"
// per data-room section. Same QA non-contamination principle as every
// other portal write route.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { PORTAL_SECTIONS } from '@/lib/dataroom-sections';
import { assertNotViewer } from '@/lib/developer-viewer';

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

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const body = await req.json().catch(() => ({})) as { orgId?: string; sectionKey?: string; reviewed?: boolean };
  if (!body.orgId || !body.sectionKey || typeof body.reviewed !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'orgId, sectionKey, and reviewed are required.' }, { status: 400 });
  }
  if (!PORTAL_SECTIONS.some((s) => s.key === body.sectionKey)) {
    return NextResponse.json({ ok: false, error: 'Unknown section.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from('investor_diligence_checklist').upsert(
    { org_id: body.orgId, investor_email: email, section_key: body.sectionKey, reviewed: body.reviewed, reviewed_at: body.reviewed ? new Date().toISOString() : null },
    { onConflict: 'org_id,investor_email,section_key' },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
