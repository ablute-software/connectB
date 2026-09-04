// Prompt 124 C2 — minimal page_view sensor (route + org + timestamp) on
// the 6 key activation-funnel routes. Fire-and-forget from the client;
// degrades to a silent no-op pre-migration (appEventsAvailable) so a
// missing table never surfaces as a user-facing error.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer, readVerifiedViewerOrgId } from '@/lib/developer-viewer';
import { appEventsAvailable } from '@/lib/app-events-capability';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true }, { status: 200 });

  const available = await appEventsAvailable();
  if (!available) return NextResponse.json({ ok: true });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true }); // unauthenticated views aren't attributable to an org — nothing to log

  const { route } = await req.json().catch(() => ({})) as { route?: string };
  if (!route) return NextResponse.json({ ok: false, error: 'route is required.' }, { status: 400 });

  // Prompt 559 §A — verified, so a forged cookie cannot attribute this
  // event to another org.
  let orgId = await readVerifiedViewerOrgId(sb, req);
  if (!orgId) {
    const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
    orgId = member?.org_id ?? null;
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  await admin.from('app_events').insert({ event_type: 'page_view', org_id: orgId, user_id: user.id, meta: { route } });
  return NextResponse.json({ ok: true });
}
