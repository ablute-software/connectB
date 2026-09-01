// Prompt 526 Part C — how many distinct devices opened each guest link for this
// org. Founder-only, read-only, and never a gate on anything.
//
// Counts DEVICES (distinct opaque visitor keys), not opens: the same person
// reloading must not read as "shared with three people", which is the entire
// point of the cookie the guest route sets.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { distinctDeviceCounts, MULTI_DEVICE_THRESHOLD } from '@/lib/guest-link-views';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ counts: {}, threshold: MULTI_DEVICE_THRESHOLD });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ counts: {}, threshold: MULTI_DEVICE_THRESHOLD });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ counts: {}, threshold: MULTI_DEVICE_THRESHOLD }, { status: 401 });
  // Membership checked against the caller's own session, not the service-role
  // client — the founder may only ever see their own org's link activity.
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (!member) return NextResponse.json({ counts: {}, threshold: MULTI_DEVICE_THRESHOLD }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: grants } = await admin.from('access_grants').select('id').eq('org_id', orgId).is('revoked_at', null);
  const ids = (grants ?? []).map((g) => g.id as string);
  const counts = await distinctDeviceCounts(admin, ids);

  return NextResponse.json({
    counts: Object.fromEntries(counts),
    threshold: MULTI_DEVICE_THRESHOLD,
  });
}
