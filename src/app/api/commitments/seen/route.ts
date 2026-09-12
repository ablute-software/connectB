// Prompt 604 §A — the commitments page leaves a mark of "seen" on the
// caller's own membership row, and nothing else: no version, no acceptance,
// no row in terms_acceptances (that table is the contract's — see the
// migration 20260912140000 header for why reusing it was also a bug).
// Replaces Prompt 603's /api/commitments/accept.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Own row only, by construction: the update is keyed on the session's user
  // id. Idempotent — marking twice is the same true.
  const { error } = await admin.from('org_members').update({ commitments_seen: true }).eq('user_id', user.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
