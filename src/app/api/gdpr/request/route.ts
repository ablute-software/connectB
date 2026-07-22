// IRM_SPEC §5 — public data-subject request intake. No auth required: a
// GDPR/RGPD rectification or erasure request is valid however it arrives,
// and doesn't depend on the (not yet built) LinkedIn claim flow. Best-effort
// matches the claimant's email against people.email_verified across every
// org so back-office has a starting point, but never blocks on a match.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const { name, email, kind, details } = await req.json() as {
    name?: string; email?: string; kind?: 'rectify' | 'erase'; details?: string;
  };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
  }
  if (kind !== 'rectify' && kind !== 'erase') {
    return NextResponse.json({ ok: false, error: 'kind must be rectify or erase.' }, { status: 400 });
  }
  if (!details || !details.trim()) {
    return NextResponse.json({ ok: false, error: 'Please describe what you are requesting.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: match } = await admin.from('people').select('id').ilike('email_verified', email).limit(1).maybeSingle();

  const { error } = await admin.from('gdpr_requests').insert({
    person_id: match?.id ?? null,
    claimant_name: name || null,
    claimant_email: email,
    kind,
    details: details.trim(),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
