import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { decryptToken } from '@/lib/crypto';
import { revokeGoogleToken } from '@/lib/google-oauth';

export async function POST() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: row } = await sb.from('email_connections').select('refresh_token_enc').eq('user_id', user.id).eq('provider', 'gmail').maybeSingle();
  if (row) {
    try { await revokeGoogleToken(decryptToken(row.refresh_token_enc)); } catch { /* best-effort */ }
  }
  const { error } = await sb.from('email_connections').delete().eq('user_id', user.id).eq('provider', 'gmail');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
