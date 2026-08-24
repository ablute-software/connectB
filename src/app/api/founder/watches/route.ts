// Prompt 348 §A — founder side: the watchers list (transparency — "quem me
// acompanha", name + status only, never notes/ratings/orderings, none of
// which this table or query ever touches) and accept/decline/revoke.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getWatchersForOrg, respondToWatch, revokeWatch } from '@/lib/investor-watching-db';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ watchers: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ watchers: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const watchers = await getWatchersForOrg(admin, member.org_id as string);
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

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 403 });
  const orgId = member.org_id as string;

  const body = await req.json().catch(() => ({})) as { watchId?: string; action?: 'accept' | 'decline' | 'revoke' };
  if (!body.watchId || !body.action) return NextResponse.json({ ok: false, error: 'watchId and action are required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = body.action === 'revoke'
    ? await revokeWatch(admin, body.watchId, orgId, user.id)
    : await respondToWatch(admin, body.watchId, orgId, body.action === 'accept' ? 'active' : 'declined', user.id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
