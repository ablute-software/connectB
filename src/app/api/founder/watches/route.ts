// Prompt 348 §A — founder side: the watchers list (transparency — "quem me
// acompanha", name + status only, never notes/ratings/orderings, none of
// which this table or query ever touches) and accept/decline/revoke.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getWatchersForOrg, respondToWatch, revokeWatch } from '@/lib/investor-watching-db';
import { assertNotViewer, resolveViewedOrgId } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ watchers: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  // Prompt 902 — the viewed org in a Developer Viewer session, the caller's own otherwise.
  const orgId = await resolveViewedOrgId(sb, req, user.id);
  if (!orgId) return NextResponse.json({ watchers: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const watchers = await getWatchersForOrg(admin, orgId);
  return NextResponse.json({ watchers });
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

  // Prompt 902 — assertNotViewer above means this is never a viewer session, so
  // this is the caller's own org; the shared resolver keeps one answer to the question.
  const orgId = await resolveViewedOrgId(sb, req, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { watchId?: string; action?: 'accept' | 'decline' | 'revoke' };
  if (!body.watchId || !body.action) return NextResponse.json({ ok: false, error: 'watchId and action are required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = body.action === 'revoke'
    ? await revokeWatch(admin, body.watchId, orgId, user.id)
    : await respondToWatch(admin, body.watchId, orgId, body.action === 'accept' ? 'active' : 'declined', user.id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
