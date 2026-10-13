// Prompt 911 (B.2) — the back-office read side of the authentication-email failure registry (Backoffice -> Email delivery).
// The last 200 failures, newest first, with the provider's own text; plus the count of the last 24 hours, which is the
// number that says "something is wrong right now". Platform administrators only.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin.from('auth_email_failures')
    .select('id, created_at, email, action, source, http_status, error_code, error_message')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = data ?? [];
  const dayAgo = Date.now() - 86_400_000;
  const last24h = rows.filter((r) => Date.parse(r.created_at as string) >= dayAgo).length;
  const people = new Set(rows.filter((r) => Date.parse(r.created_at as string) >= dayAgo).map((r) => r.email as string)).size;
  return NextResponse.json({ ok: true, rows, last24h, peopleLast24h: people });
}
