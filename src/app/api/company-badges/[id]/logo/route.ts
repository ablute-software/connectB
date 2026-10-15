// Prompt 918 C.4 — the logo of one of the founder's OWN badges, whatever its state (a private, still-unverified badge shows its logo in
// the founder's card too). Also what the founder's "see how investors see this profile" preview points at, since the investor's route
// (/api/portal/badge-logo/[badgeId]) rightly refuses anyone who is not an eligible investor. Read-only, so it also answers in a
// Developer Viewer session (the VIEWED org's badge); the bytes come from badge-logo-proxy.ts, which only serves the org's own files.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';
import { serveBadgeLogo } from '@/lib/badge-logo-proxy';

export const runtime = 'nodejs';

export const GET = withActingOrg(async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = acting.orgId as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: badge } = await admin.from('company_badges')
    .select('logo_storage_path, logo_url').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!badge) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  return serveBadgeLogo({
    admin, req,
    badge: { org_id: orgId, logo_storage_path: (badge.logo_storage_path as string | null) ?? null, logo_url: (badge.logo_url as string | null) ?? null },
  });
});
