// I-01b (Nuno, 30/09) — the signup that starts from an incubator invite asks
// here, BEFORE creating the account, whether the address the founder typed is
// the invited one. The browser never has the full invited address (the
// preview is masked); this answers yes/no plus the masked form for the
// message. Token-authorised and rate-limited per IP exactly like the preview:
// it confirms only an address the caller already typed, for a link they
// already hold. Accept/decline keep their own check in SQL, unchanged.
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
  const { data: inv } = await admin.from('incubator_invites')
    .select('email, status').eq('token_hash', hashToken(params.token)).maybeSingle();
  if (!inv) return NextResponse.json({ ok: false, error: 'invite_not_found' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    matches: inviteEmailMatches(inv.email, email),
    invitedEmailMasked: maskInviteEmail(inv.email),
  });
}
