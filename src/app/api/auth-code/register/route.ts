// Prompt 904 Part B — step 1 of "register with a 6-digit code": validate, create the
// unconfirmed account and have Supabase mail the code. The answer is identical for an email
// that has no account, an unconfirmed one and a confirmed one (see service.ts).
import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/guest-link-security';
import { authCodeAllows } from '@/lib/auth-code/mode';
import { normalizeEmail, readProfile } from '@/lib/auth-code/policy';
import { requestCode } from '@/lib/auth-code/service';
import { adminClientOrNull, makeSupabasePorts } from '@/lib/auth-code/supabase-ports';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  // Switch off (the default) = the route does not exist.
  if (!authCodeAllows(email)) return NextResponse.json({ ok: false }, { status: 404 });
  const admin = adminClientOrNull();
  if (!admin) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });

  const result = await requestCode(
    makeSupabasePorts(admin),
    { email, profile: readProfile(body), password: typeof body.password === 'string' ? body.password : '', ip: clientIp(req) },
    { allowCreate: true },
  );
  return NextResponse.json(result.body, { status: result.status });
}
