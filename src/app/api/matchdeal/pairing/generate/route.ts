// MatchDeal QR pairing (spec Section 4) — generates a fresh, opaque,
// single-use, 5-minute pairing token for the caller's own org+kind.
// Regenerating invalidates any prior active token for the same user+kind
// (spec: "um token ativo de cada vez por utilizador"). Rate-limited to 10
// generations/hour/user (spec Section 8).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { logEvent } from '@/lib/analytics-events';
import { PAIRING_RATE_LIMIT_PER_HOUR, PAIRING_TOKEN_TTL_MS, generateRawToken, hashToken, resolveCallerOrgId, type PairingKind } from '@/lib/matchdeal-pairing';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { kind } = await req.json().catch(() => ({})) as { kind?: PairingKind };
  if (kind !== 'startup' && kind !== 'investor') return NextResponse.json({ ok: false, error: 'kind must be startup or investor.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const orgId = await resolveCallerOrgId(sb, admin, user.id, kind);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No linked organization for this account.' }, { status: 403 });

  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count: recentCount } = await admin.from('matchdeal_pairing_tokens').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).gte('created_at', hourAgo);
  if ((recentCount ?? 0) >= PAIRING_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ ok: false, error: 'Too many codes requested — try again in a bit.' }, { status: 429 });
  }

  // Invalidate any still-active token for this user+kind before issuing a new one.
  await admin.from('matchdeal_pairing_tokens').update({ status: 'revoked' })
    .eq('user_id', user.id).eq('kind', kind).eq('status', 'active');

  const raw = generateRawToken();
  const expiresAt = new Date(Date.now() + PAIRING_TOKEN_TTL_MS).toISOString();
  const { error } = await admin.from('matchdeal_pairing_tokens').insert({
    token_hash: hashToken(raw), org_id: orgId, kind, user_id: user.id, expires_at: expiresAt,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logEvent(admin, { organizationId: orgId, organizationType: kind, eventType: 'matchdeal_pair_token_generated', sourceOfAction: 'manual' });
  await logEvent(admin, { organizationId: orgId, organizationType: kind, eventType: 'matchdeal_pair_qr_shown', sourceOfAction: 'manual' });

  const origin = req.headers.get('origin') ?? 'https://sherlockdeal.com';
  return NextResponse.json({ ok: true, token: raw, expiresAt, pairUrl: `${origin}/matchdeal/pair?token=${raw}` });
}
