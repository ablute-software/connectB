// Prompt 727 §6 — "uma tabela ou reutilização de interactions com
// channel='system' não serve" — this is that new, simple table, PROPOSED
// only (supabase/migrations/20260923150000_product_events.sql, not
// applied). Until it's applied, productEventsAvailable() is false and this
// route no-ops (still 200, never surfaces a missing-migration error to a
// fire-and-forget client call).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { productEventsAvailable } from '@/lib/product-events-capability';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';

// Prompt 904 — ignored in a Developer Viewer session (withActingOrg's ignoreInViewer). Before
// this, a developer copying a message or opening a dossier inside a customer's workspace
// was recorded against the DEVELOPER's own org, skewing its funnel.
const KNOWN_EVENTS = new Set(['dossier_opened', 'next_step_seen', 'message_copied', 'log_prefilled', 'interaction_logged']);

export const POST = withActingOrg(async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: true, noop: true });
  if (!(await productEventsAvailable())) return NextResponse.json({ ok: true, noop: true });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, noop: true });

  const body = await req.json().catch(() => ({})) as { event?: string; entityId?: string };
  if (!body.event || !KNOWN_EVENTS.has(body.event)) return NextResponse.json({ ok: false, error: 'Unknown event.' }, { status: 400 });

  const orgId = (await resolveActingOrg(req, user, sb)).orgId;
  if (!orgId) return NextResponse.json({ ok: true, noop: true });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  await admin.from('product_events').insert({
    org_id: orgId, user_id: user.id, event: body.event, entity_id: body.entityId ?? null,
  });
  return NextResponse.json({ ok: true });
}, { ignoreInViewer: true });
