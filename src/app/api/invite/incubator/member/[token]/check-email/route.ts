// Prompt I-01c §A.5 — the member-invite sibling of the startup invite's
// check-email (I-01b): the account created from a team invite is confirmed to
// be the invited address BEFORE it is created. The browser only ever has the
// masked address. Token-authorised and rate-limited like the preview.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashToken } from '@/lib/matchdeal-pairing';
import { clientIp, guestLinkRateLimited } from '@/lib/guest-link-security';
import { inviteEmailMatches, maskInviteEmail } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (await guestLinkRateLimited(admin, clientIp(req))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }
  const { email } = await req.json().catch(() => ({})) as { email?: string };
  const { data: m } = await admin.from('incubator_members')
    .select('invited_email').eq('invite_token_hash', hashToken(params.token)).maybeSingle();
  if (!m) return NextResponse.json({ ok: false, error: 'invite_not_found' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    matches: inviteEmailMatches(m.invited_email, email),
    invitedEmailMasked: maskInviteEmail(m.invited_email),
  });
}
