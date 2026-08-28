// Prompt 421 §D.2 — "notify when a new eligible startup enters my
// pipeline" toggle. matchdeal_investor_members writes are admin-route-only
// (0053's own policy is SELECT-only) — same reason investor-profile/
// route.ts and every other mutation in this directory goes through the
// admin client rather than a direct RLS write.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ ok: false, error: 'enabled must be a boolean.' }, { status: 400 });

  const { error } = await admin.from('matchdeal_investor_members')
    .update({ notify_new_eligible_startup: body.enabled }).eq('id', member.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, enabled: body.enabled });
}
