// IRM_SPEC §1b — cross-org contributions feed for the back-office. Platform
// admin only. Uses the service role to join across orgs (entities/people
// RLS is per-org, so a plain client query can't see this) and enriches each
// contribution with a human-readable subject/org name for display.
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
  const { data: contributions, error } = await admin
    .from('contributions')
    .select('id, subject_type, subject_id, org_id, field, value, note, status, created_at, reviewer_notes')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const entityIds = [...new Set(contributions.filter((c) => c.subject_type === 'entity').map((c) => c.subject_id))];
  const personIds = [...new Set(contributions.filter((c) => c.subject_type === 'person').map((c) => c.subject_id))];
  const orgIds = [...new Set(contributions.map((c) => c.org_id))];

  const [{ data: entities }, { data: people }, { data: orgs }] = await Promise.all([
    entityIds.length ? admin.from('entities').select('id, name').in('id', entityIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    personIds.length ? admin.from('people').select('id, full_name').in('id', personIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    orgIds.length ? admin.from('orgs').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const entityName = new Map((entities ?? []).map((e) => [e.id, e.name]));
  const personName = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const enriched = contributions.map((c) => ({
    ...c,
    subject_name: (c.subject_type === 'entity' ? entityName.get(c.subject_id) : personName.get(c.subject_id)) ?? '(deleted)',
    org_name: orgName.get(c.org_id) ?? '(unknown org)',
  }));

  return NextResponse.json({ ok: true, contributions: enriched });
}
