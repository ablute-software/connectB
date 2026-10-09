// Prompt 904 Part C — activate a custom plan with an entity-bound code. The code only works for
// someone who already holds an approved claim and an active seat on the profile it was made for; every
// refusal reads the same, so a forwarded or guessed code teaches nothing.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { redeemSeatCode, SEAT_CODE_REFUSED } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { code?: string };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const result = await redeemSeatCode(makeSeatStore(admin), { code: body.code ?? '', userId: user.id });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? SEAT_CODE_REFUSED }, { status: result.status });
  return NextResponse.json({ ok: true, seats: result.seats });
}
