// Prompt 122 Block B (F1) §2.3 — access_grants is created entirely
// client-side (store-supabase.tsx's addGrant, via the founder's own RLS —
// see migration 0001's generic is_org_member() policy loop), with no
// server hop at all. ecosystem_facts, by design, only ever accepts writes
// from the service-role client (see 0116's own RLS comment) — so this tiny
// route is the one server touch-point needed to instrument that event
// without changing where or how grants themselves get created. Called
// fire-and-forget (best-effort, never awaited) right after the real
// insert succeeds; a failure here never surfaces to the founder and never
// blocks or retries the grant itself.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { recordGrantCreatedFact } from '@/lib/ecosystem-facts';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 200 });

  const body = await req.json().catch(() => ({})) as { orgId?: string; grantId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false }, { status: 200 });

  // Same membership check the direct client insert's RLS already enforces
  // (is_org_member(org_id)) — this route only ever observes an event for
  // an org the caller actually belongs to.
  const { data: membership } = await sb.from('org_members').select('org_id').eq('org_id', body.orgId).eq('user_id', user.id).maybeSingle();
  if (!membership) return NextResponse.json({ ok: false }, { status: 200 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  await recordGrantCreatedFact(admin, { orgId: body.orgId, grantId: body.grantId });
  return NextResponse.json({ ok: true });
}
