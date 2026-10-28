// Prompt 923 (B, C) — "Send me a code" on the invitation page. The address is NOT sent by the browser: it is the invitation's own, so the code can only go to the person the invitation is for, and a malformed address can never
// reach the email provider (on 28/10/2026 "…@gmail.c" came back as a 500 nobody could read). The provider's answers are turned into sentences (wait N seconds, check the address, try again with a reference) and a failure
// nobody can fix is written to the failure log with that reference. A new code replaces the previous one (the provider's own behaviour): the page says so.
import { NextResponse } from 'next/server';
import { withoutViewer } from '@/lib/acting-org';
import { createClient } from '@supabase/supabase-js';
import { describeAuthError, emailProblem, newReference } from '@/lib/auth-errors';
import { recordAuthEmailFailure } from '@/lib/auth-code/failure-log';
import { loadInvite } from '@/lib/seat-invites-store';
import { SUPABASE_ANON, SUPABASE_URL } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withoutViewer(async function POST(_req: Request, { params }: { params: { token: string } }) {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON || !service) return NextResponse.json({ ok: false, code: 'not_configured', error: 'This is not available right now.' }, { status: 503 });
  const admin = createClient(SUPABASE_URL, service, { auth: { persistSession: false } });
  const invite = await loadInvite(admin, params.token);
  if (!invite) return NextResponse.json({ ok: false, code: 'invalid', error: 'This invitation is not valid. Ask the person who invited you to send it again.' }, { status: 404 });
  if (invite.status !== 'open') return NextResponse.json({ ok: false, code: 'closed', error: invite.status === 'accepted' ? 'This invitation has already been used.' : `This invitation was cancelled. Ask ${invite.firmName} to send you a new one.` }, { status: 410 });
  // Whatever is stored must still look like an address before the provider sees it.
  const problem = emailProblem(invite.email);
  if (problem) return NextResponse.json({ ok: false, code: 'invalid_email', error: problem }, { status: 400 });

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anon.auth.signInWithOtp({ email: invite.email.trim().toLowerCase(), options: { shouldCreateUser: true } });
  if (!error) return NextResponse.json({ ok: true, message: `We sent a 6-digit code to ${invite.email}.` });

  const ref = newReference();
  const info = describeAuthError(error, { ref });
  if (info.kind === 'generic' || info.kind === 'send_failed') {
    await recordAuthEmailFailure(admin, { email: invite.email, action: 'invite_signup', source: 'server', error, message: `[ref ${ref}] ${typeof error.message === 'string' ? error.message : ''}` });
  }
  const status = info.kind === 'rate_limited' ? 429 : info.kind === 'invalid_email' ? 400 : 502;
  return NextResponse.json({ ok: false, code: info.kind, error: info.text, retryAfterSeconds: info.retryAfterSeconds, ref: info.ref }, { status });
});
