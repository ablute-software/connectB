// IRM_SPEC §5/§6a — GDPR request queue for the back-office. Platform admin
// only. For each request, re-resolves matching people across every org by
// email at read time (not just the one person_id captured at submission)
// so an "erase" action can be scoped to everything actually affected.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: requests, error } = await admin
    .from('gdpr_requests')
    .select('id, person_id, claimant_name, claimant_email, kind, details, status, created_at, resolved_at')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const emails = [...new Set(requests.map((r) => r.claimant_email.toLowerCase()))];
  const { data: matches } = emails.length
    ? await admin.from('people').select('id, full_name, org_id, email_verified').in('email_verified', emails)
    : { data: [] as { id: string; full_name: string; org_id: string; email_verified: string }[] };
  const orgIds = [...new Set((matches ?? []).map((m) => m.org_id))];
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] as { id: string; name: string }[] };
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const enriched = requests.map((r) => ({
    ...r,
    matches: (matches ?? [])
      .filter((m) => m.email_verified?.toLowerCase() === r.claimant_email.toLowerCase())
      .map((m) => ({ personId: m.id, name: m.full_name, orgName: orgName.get(m.org_id) ?? '(unknown org)' })),
  }));

  return NextResponse.json({ ok: true, requests: enriched });
}
