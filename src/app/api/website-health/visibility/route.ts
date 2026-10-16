// Prompt 919 C.4 / D — the founder's switch: "Show my website health score to investors". OFF by default, and off means off on the SERVER:
// the dossier code reads `orgs.website_score_visible` before it selects a single score, so nothing is fetched-then-hidden (the same rule
// as the round-progress checkbox, CLAUDE.md "Startup-performance privacy"). Only the founder's own org, only a boolean, and — like every
// write — never inside a Developer Viewer session (withActingOrg answers 403 viewer_read_only before this runs).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';
import { websiteHealthAvailable } from '@/lib/website-health-capability';

export const POST = withActingOrg(async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { visible?: unknown };
  if (typeof body.visible !== 'boolean') return NextResponse.json({ ok: false, error: 'visible must be true or false.' }, { status: 400 });
  if (!(await websiteHealthAvailable())) return NextResponse.json({ ok: false, available: false, error: 'Website health is not available in your workspace yet.' }, { status: 503 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from('orgs').update({ website_score_visible: body.visible }).eq('id', acting.orgId as string);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, visibleToInvestors: body.visible });
});
