// Prompt 904 Part B — "send me another code". The server, not the countdown in the browser,
// enforces the 60 s gap and the hourly cap. A new code invalidates the previous one.
import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/guest-link-security';
import { redirectUrl } from '@/lib/auth-redirect';
import { authCodeAllows } from '@/lib/auth-code/mode';
import { normalizeEmail, readExtras } from '@/lib/auth-code/policy';
import { requestCode } from '@/lib/auth-code/service';
import { adminClientOrNull, makeSupabasePorts } from '@/lib/auth-code/supabase-ports';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  if (!authCodeAllows(email)) return NextResponse.json({ ok: false }, { status: 404 });
  const admin = adminClientOrNull();
  if (!admin) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });

  const result = await requestCode(
    makeSupabasePorts(admin),
    { email, profile: { fullName: '', startup: '', country: '', role: '' }, ip: clientIp(req), ctx: { intent: null, redirectTo: redirectUrl(new URL(req.url).origin, readExtras(body).redirectPath) } },
    { allowCreate: false },
  );
  return NextResponse.json(result.body, { status: result.status });
}
