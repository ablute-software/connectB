// MatchDeal QR pairing — polled by the modal (and usable as a Realtime
// fallback) to know: is there an active pairing, and if not, is there
// still a live token on screen or has it expired.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveCallerOrgId, type PairingKind } from '@/lib/matchdeal-pairing';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind') as PairingKind | null;
  if (kind !== 'startup' && kind !== 'investor') return NextResponse.json({ ok: false, error: 'kind must be startup or investor.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const orgId = await resolveCallerOrgId(sb, admin, user.id, kind);
  if (!orgId) return NextResponse.json({ ok: true, linked: false, pairings: [], activeToken: null });

  const [{ data: pairings }, { data: activeToken }] = await Promise.all([
    admin.from('matchdeal_pairings').select('id, device_id, paired_at, last_seen_at, status')
      .eq('org_id', orgId).eq('kind', kind).eq('status', 'active').order('paired_at', { ascending: false }),
    admin.from('matchdeal_pairing_tokens').select('expires_at').eq('org_id', orgId).eq('kind', kind).eq('user_id', user.id)
      .eq('status', 'active').gt('expires_at', new Date().toISOString()).maybeSingle(),
  ]);

  return NextResponse.json({
    ok: true, linked: true, orgId, pairings: pairings ?? [],
    activeToken: activeToken ? { expiresAt: activeToken.expires_at } : null,
  });
}
