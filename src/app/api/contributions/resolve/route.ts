// Founder-facing conflict resolution (§9b import conflicts, batch 2 item 4).
// Distinct from /api/backoffice/contributions/[id]/review — that route is
// platform-admin-only and only ever flips status for the cross-org catalog
// verification queue. This one lets the founder resolve their OWN org's
// import conflicts (keep the existing value, or apply the imported one) —
// RLS has no update policy for org members on `contributions` (by design,
// see 0006_contributions.sql), so this goes through service-role after an
// explicit org-membership check, same pattern as the other founder-triggered
// writes in this codebase (nda-upload, classify-entity).
//
// This route ONLY flips the contribution's status. Applying the imported
// value onto the entity/person row itself is the caller's job via the
// normal updateEntity/updatePerson store actions — kept separate so this
// stays a single-purpose, easily-reasoned-about write.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { contributionId, decision } = await req.json() as { contributionId?: string; decision?: 'keep_existing' | 'use_imported' };
  if (!contributionId || !decision) return NextResponse.json({ ok: false, error: 'contributionId and decision required' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: contribution, error: fetchErr } = await admin.from('contributions').select('org_id').eq('id', contributionId).maybeSingle();
  if (fetchErr || !contribution) return NextResponse.json({ ok: false, error: fetchErr?.message ?? 'Contribution not found.' }, { status: 404 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', contribution.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const status = decision === 'use_imported' ? 'verified' : 'rejected';
  const { error } = await admin.from('contributions').update({
    status, reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  }).eq('id', contributionId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
