// Prompt 923 (B) — what the invitation page shows before anybody signs in: the firm and the invited email (the page fills it in and locks it — a typo there would send the code to a stranger). The token is the bearer;
// an unknown or malformed one is a 404 that says nothing else. It never says whether the email already has an account.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadInvite } from '@/lib/seat-invites-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false }, { status: 404 });
  const invite = await loadInvite(createClient(url, key, { auth: { persistSession: false } }), params.token);
  if (!invite) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, firmName: invite.firmName, email: invite.email, status: invite.status });
}
