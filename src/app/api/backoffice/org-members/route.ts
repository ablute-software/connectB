// Prompt 123 Block C.1 — "Members" column expansion: name/email/role for
// one org, on demand (not bundled into the main list response, which stays
// counts-only for the collapsed table).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const { data: members, error } = await admin.from('org_members').select('user_id, role').eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const result = [];
  for (const m of members ?? []) {
    const { data } = await admin.auth.admin.getUserById(m.user_id as string);
    result.push({ userId: m.user_id, role: m.role, email: data?.user?.email ?? '(unknown)' });
  }
  return NextResponse.json({ ok: true, members: result });
}
