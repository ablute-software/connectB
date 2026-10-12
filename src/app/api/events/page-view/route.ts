// Prompt 124 C2 — minimal page_view sensor (route + org + timestamp) on
// the 6 key activation-funnel routes. Fire-and-forget from the client;
// degrades to a silent no-op pre-migration (appEventsAvailable) so a
// missing table never surfaces as a user-facing error.
//
// Prompt 904 — a Developer Viewer session is IGNORED (withActingOrg's ignoreInViewer:
// 200 { ignored: 'viewer' }, the handler never runs): looking at a customer's
// workspace is neither that customer's activity nor the developer's own, and the
// old 403 only filled the console. Outside a viewer session the org is the
// caller's own membership, via the one resolver.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { appEventsAvailable } from '@/lib/app-events-capability';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';

export const POST = withActingOrg(async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true }, { status: 200 });

  const available = await appEventsAvailable();
  if (!available) return NextResponse.json({ ok: true });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true }); // unauthenticated views aren't attributable to an org — nothing to log

  const { route } = await req.json().catch(() => ({})) as { route?: string };
  if (!route) return NextResponse.json({ ok: false, error: 'route is required.' }, { status: 400 });

  // Prompt 559 §A / 904 — verified, so a forged cookie cannot attribute this
  // event to another org.
  const orgId = (await resolveActingOrg(req, user, sb)).orgId;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  await admin.from('app_events').insert({ event_type: 'page_view', org_id: orgId, user_id: user.id, meta: { route } });
  return NextResponse.json({ ok: true });
}, { ignoreInViewer: true });
