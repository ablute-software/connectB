// Team roster for the settings page. Any org member can view (RLS-scoped
// via the caller's own session for the org_id/role lookup); emails come
// from auth.users, which only the service-role client can read, so the
// listing itself runs under service role after that authorization check.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActingOrg, withActingOrg } from '@/lib/acting-org';

// Prompt 894 / 904 — a Developer Viewer session lists the VIEWED org's roster
// (resolveActingOrg). `myRole` is null there — a viewer session has no role in
// the viewed org — and `isSelf` just reads as "not a match".
//
// This file lists org_members on purpose (the roster IS the membership table);
// which org it lists is still the one resolver's answer. Writes live in
// [userId]/route.ts, which a viewer session never reaches (withoutViewer).
export const GET = withActingOrg(async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const orgId = acting.orgId;
  const myRole = acting.role;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: members, error } = await admin.from('org_members').select('user_id, role').eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const withEmails = await Promise.all((members ?? []).map(async (m) => {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    return { userId: m.user_id, role: m.role, email: data.user?.email ?? '(unknown)', isSelf: m.user_id === user.id };
  }));

  return NextResponse.json({ ok: true, members: withEmails, myRole });
});
