// BLOCO 3 — cross-org investor submissions queue. The founder-facing store
// only ever loaded the CURRENT org's own submissions (`.eq('org_id', orgId)`
// in store-supabase.tsx) — fine for the founder's own "did my submission go
// through" view, but wrong for back-office triage, which needs every org's
// queue in one place. Platform admin only, service role for the cross-org read.
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
  const { data: submissions, error } = await admin
    .from('investor_submissions')
    .select('id, org_id, payload, status, reviewer_notes, reviewed_by, created_at, reviewed_at, merged_catalog_id')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const orgIds = [...new Set(submissions.map((s) => s.org_id))];
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] as { id: string; name: string }[] };
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  return NextResponse.json({ ok: true, submissions: submissions.map((s) => ({ ...s, org_name: orgName.get(s.org_id) ?? '(unknown org)' })) });
}
