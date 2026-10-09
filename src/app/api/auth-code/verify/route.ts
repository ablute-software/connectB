// Prompt 904 Part B — step 2: the code typed on the same page. Counts the attempt first
// (5 wrong -> new code required), then lets Supabase check it; on success the browser is
// signed in and the typed password is applied.
import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/guest-link-security';
import { authCodeAllows } from '@/lib/auth-code/mode';
import { normalizeEmail, readProfile } from '@/lib/auth-code/policy';
import { verifyRegistrationCode } from '@/lib/auth-code/service';
import { adminClientOrNull, makeSupabasePorts } from '@/lib/auth-code/supabase-ports';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  if (!authCodeAllows(email)) return NextResponse.json({ ok: false }, { status: 404 });
  const admin = adminClientOrNull();
  if (!admin) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });

  const result = await verifyRegistrationCode(makeSupabasePorts(admin), {
    email,
    code: typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '',
    password: typeof body.password === 'string' ? body.password : '',
    profile: readProfile(body),
    ip: clientIp(req),
  });
  return NextResponse.json(result.body, { status: result.status });
}
