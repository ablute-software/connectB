// Prompt I-01 §C.1 — public preview of a MEMBER invite (incubator team):
// which incubator, which role, and the address it was sent to (the person
// must sign in with that address to accept).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashToken } from '@/lib/matchdeal-pairing';
import { clientIp, guestLinkRateLimited } from '@/lib/guest-link-security';

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (await guestLinkRateLimited(admin, clientIp(req))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const { data: m } = await admin.from('incubator_members')
    .select('incubator_id, invited_email, role, status, invite_expires_at')
    .eq('invite_token_hash', hashToken(params.token)).maybeSingle();
  if (!m) return NextResponse.json({ ok: false, error: 'invite_not_found' }, { status: 404 });
  const { data: inc } = await admin.from('incubators').select('name, logo_url, closed_at').eq('id', m.incubator_id).maybeSingle();
  if (!inc) return NextResponse.json({ ok: false, error: 'invite_not_found' }, { status: 404 });
  const expired = m.invite_expires_at && new Date(m.invite_expires_at).getTime() < Date.now();
  return NextResponse.json({
    ok: true,
    status: inc.closed_at ? 'closed' : expired ? 'expired' : m.status,
    invitedEmail: m.invited_email, role: m.role,
    incubator: { name: inc.name, logoUrl: inc.logo_url },
  });
}
