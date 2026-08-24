// Prompt 341 §A/§B — records acceptance. The version accepted is ALWAYS
// TERMS_VERSION, decided here on the server — never read from the request
// body, so a client can't claim to have accepted a version it never saw.
// Idempotent: accepting twice (a double click, a retried request after a
// network blip) is a harmless no-op, not a second row or an error — the
// (user_id, version) primary key already guarantees that; a unique-
// violation on the insert is treated as success.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { TERMS_VERSION, isDuplicateAcceptance } from '@/lib/terms';

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from('terms_acceptances').insert({
    user_id: user.id, version: TERMS_VERSION, email_at_acceptance: email,
  });
  if (error && !isDuplicateAcceptance(error.code)) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, version: TERMS_VERSION });
}
