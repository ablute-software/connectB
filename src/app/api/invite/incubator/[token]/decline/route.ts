// Prompt I-01 §A.8 — decline. The invitee may have no account, so the token
// is the authority: incubator_decline_invite() is service-role only and is
// called here with it, rate-limited like the preview.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clientIp, guestLinkRateLimited } from '@/lib/guest-link-security';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (await guestLinkRateLimited(admin, clientIp(req))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const { data, error } = await admin.rpc('incubator_decline_invite', { p_token: params.token });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error, message: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true });
}
