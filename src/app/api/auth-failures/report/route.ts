// Prompt 911 (B.2) — a PAGE tells us that an authentication email could not be sent.
//
// Password recovery (and the link-only sign-up fallback, and the invite pages' legacy path) call Supabase straight from
// the browser, so the app never sees the error that comes back — on 12/10/2026 four people were turned away and the only
// trace was one day of Supabase logs. The pages now report what they were refused with, here, and the failure registry
// shows it in Backoffice. Public on purpose (the person is not signed in); therefore:
//  - only a SEND failure or a rate limit is recorded (anything else is ignored — a wrong password is not an outage);
//  - the action is one of a fixed list, the email must look like an email, the text is truncated;
//  - per-IP limited like the code routes, so it cannot be used to fill the table.
// The answer is always the same 200, so it is not an oracle for anything.
import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/guest-link-security';
import { describeAuthError } from '@/lib/auth-errors';
import { isValidEmailShape, normalizeEmail, IP_REQUEST_LIMIT, IP_WINDOW_SECONDS } from '@/lib/auth-code/policy';
import { adminClientOrNull } from '@/lib/auth-code/supabase-ports';
import { recordAuthEmailFailure, type AuthFailureAction } from '@/lib/auth-code/failure-log';

const BROWSER_ACTIONS: readonly AuthFailureAction[] = ['signup', 'recover', 'invite_signup', 'login'];

export async function POST(req: NextRequest) {
  const done = () => NextResponse.json({ ok: true });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const action = BROWSER_ACTIONS.find((a) => a === body.action);
  if (!action || !isValidEmailShape(email)) return done();

  const status = typeof body.status === 'number' ? body.status : null;
  const code = typeof body.code === 'string' ? body.code.slice(0, 80) : null;
  const message = typeof body.message === 'string' ? body.message.slice(0, 400) : null;
  const kind = describeAuthError({ status, code, message }).kind;
  if (kind !== 'send_failed' && kind !== 'rate_limited') return done();

  const admin = adminClientOrNull();
  if (!admin) return done();
  const { data, error } = await admin.rpc('auth_code_ip_hit', { p_ip: clientIp(req), p_kind: 'request', p_limit: IP_REQUEST_LIMIT, p_window_seconds: IP_WINDOW_SECONDS });
  if (!error && data === true) return done(); // over its limit: drop silently
  await recordAuthEmailFailure(admin, { email, action, source: 'browser', status, code, message });
  return done();
}
