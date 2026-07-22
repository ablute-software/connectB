// BLOCO 3 — profile-claim review queue (IRM_SPEC §5). Table exists but stays
// empty until LinkedIn OAuth is actually wired (see src/app/portal/page.tsx,
// NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED) — this route is ready for when it isn't.
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
  const { data: claims, error } = await admin
    .from('profile_claims')
    .select('id, person_id, claimant_email, match_score, status, created_at, resolved_at')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const personIds = [...new Set(claims.map((c) => c.person_id).filter(Boolean))] as string[];
  const { data: people } = personIds.length
    ? await admin.from('people').select('id, full_name, org_id').in('id', personIds)
    : { data: [] as { id: string; full_name: string; org_id: string }[] };
  const orgIds = [...new Set((people ?? []).map((p) => p.org_id))];
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] as { id: string; name: string }[] };
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const personById = new Map((people ?? []).map((p) => [p.id, p]));

  const enriched = claims.map((c) => {
    const person = c.person_id ? personById.get(c.person_id) : undefined;
    return { ...c, personName: person?.full_name ?? null, orgName: person ? orgName.get(person.org_id) ?? null : null };
  });

  return NextResponse.json({ ok: true, claims: enriched });
}
