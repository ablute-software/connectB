// NEXT_STEPS Phase 4 — investor NDA acceptance, service-role (see access/route.ts note).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const normalizedEmail = String(email).trim().toLowerCase();

  const { data: person } = await admin.from('people').select('id').eq('email_verified', normalizedEmail).maybeSingle();
  const orParts = [`grantee_email.eq.${normalizedEmail}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);

  const { error } = await admin.from('access_grants')
    .update({ nda_accepted_at: new Date().toISOString() })
    .is('revoked_at', null).is('nda_accepted_at', null).eq('nda_required', true)
    .or(orParts.join(','));
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
