// Prompt 603 §C — records acceptance of the commitments: version decided
// HERE (never read from the client), date, and the email at acceptance —
// "registar aceitação com versão, data e origem é o que tem valor; o resto é
// teatro". Same table and same idempotency as /api/terms/accept.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { COMMITMENTS_VERSION } from '@/lib/commitments';
import { isDuplicateAcceptance } from '@/lib/terms';

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from('terms_acceptances').insert({ user_id: user.id, version: COMMITMENTS_VERSION, email_at_acceptance: email });
  if (error && !isDuplicateAcceptance(error.code)) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, version: COMMITMENTS_VERSION });
}
