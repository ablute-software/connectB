// Prompt 923 (B) — accept a seat invitation as the signed-in account. GET answers what the page needs after the code (does this account still have to give a name and a role? is it the invited address?); POST joins the
// firm, or says why it cannot — and the invitation stays open. Only the account whose CONFIRMED email is the invited one can accept (acceptSeatInvite): the link alone is not enough.
import { NextResponse } from 'next/server';
import { withoutViewer } from '@/lib/acting-org';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { acceptSeatInvite, normalizeInviteEmail, ONE_FIRM_PER_ACCOUNT } from '@/lib/seat-invite-accept';
import { loadInvite, makeInvitePorts } from '@/lib/seat-invites-store';

export const dynamic = 'force-dynamic';

async function context() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  return { admin: createClient(url, key, { auth: { persistSession: false } }), user };
}
const hasProfile = (meta: Record<string, unknown> | undefined) => !!(typeof meta?.full_name === 'string' && meta.full_name.trim() && typeof meta?.job_title === 'string' && meta.job_title.trim());

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const c = await context();
  if (!c) return NextResponse.json({ ok: false }, { status: 404 });
  if (!c.user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const invite = await loadInvite(c.admin, params.token);
  if (!invite) return NextResponse.json({ ok: false }, { status: 404 });
  const matches = normalizeInviteEmail(c.user.email) === normalizeInviteEmail(invite.email) && !!c.user.email_confirmed_at;
  return NextResponse.json({ ok: true, signedInAs: c.user.email ?? null, matches, needsProfile: matches && !hasProfile(c.user.user_metadata) });
}

export const POST = withoutViewer(async function POST(req: Request, { params }: { params: { token: string } }) {
  const c = await context();
  if (!c) return NextResponse.json({ ok: false, code: 'invalid', error: 'This is not available right now.' }, { status: 503 });
  if (!c.user) return NextResponse.json({ ok: false, code: 'unconfirmed', error: 'Sign in first: use the code we sent you.' }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { name?: unknown; role?: unknown };
  const result = await acceptSeatInvite(makeInvitePorts(c.admin), {
    token: params.token,
    account: { id: c.user.id, email: c.user.email ?? null, emailConfirmed: !!c.user.email_confirmed_at },
    profile: { name: typeof body.name === 'string' ? body.name : '', role: typeof body.role === 'string' ? body.role : '' },
    needsProfile: !hasProfile(c.user.user_metadata) && !(typeof body.name === 'string' && body.name.trim() && typeof body.role === 'string' && body.role.trim()),
    oneFirmPerAccount: ONE_FIRM_PER_ACCOUNT,
  });
  if (!result.ok) return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, firmName: result.firmName, alreadyAccepted: result.alreadyAccepted, next: '/go?as=investor' });
});
