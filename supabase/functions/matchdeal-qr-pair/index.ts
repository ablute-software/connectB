// MatchDeal — Edge Function: consume a web-generated QR pairing token.
//
// The reverse-direction counterpart to matchdeal-pair (which handles
// "phone shows a code, web enters it"). This one is "web shows a QR,
// phone scans it" — called by the MatchDeal MOBILE APP once it recognizes
// https://sherlockdeal.com/matchdeal/pair?token=... as its own deep link
// (Universal Link / App Link) and has its own authenticated Supabase
// session. NOT callable yet by anything real: no app build implements
// this call, and no Universal Link / App Link registration exists on
// either side yet (confirmed absent in this repo — see the MatchDeal QR
// pairing report). Built ahead of the app team's own work so the backend
// half is ready and independently testable the moment they wire it up.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Same hashing as src/lib/matchdeal-pairing.ts's hashToken() (Node
// crypto sha256 hex) — must match exactly, this is Web Crypto's
// equivalent for the Deno runtime.
async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function logAudit(admin: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  await admin.from('matchdeal_pairing_audit').insert(row).then(() => {}, () => {});
}

async function logEvent(admin: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  await admin.from('analytics_events').insert(row).then(() => {}, () => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'Sign in first.' }, 401);

  let body: { token?: string; deviceId?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400); }
  const rawToken = body.token?.trim();
  const deviceId = body.deviceId?.trim();
  if (!rawToken || !deviceId) return json({ ok: false, error: 'token and deviceId are required.' }, 400);

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: 'Not a valid Sherlock Deal session.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const tokenHash = await hashToken(rawToken);

  const { data: tokenRow } = await admin.from('matchdeal_pairing_tokens').select('*').eq('token_hash', tokenHash).maybeSingle();
  if (!tokenRow) {
    await logAudit(admin, { token_hash: tokenHash, attempted_by_user_id: user.id, result: 'unknown_token' });
    return json({ ok: false, error: 'MATCHDEAL_TOKEN_INVALID' }, 410);
  }

  if (tokenRow.status !== 'active') {
    const category = tokenRow.status === 'used' ? 'already_used' : 'other';
    await logAudit(admin, { token_hash: tokenHash, token_org_id: tokenRow.org_id, attempted_by_user_id: user.id, result: category });
    await logEvent(admin, { organization_id: tokenRow.org_id, organization_type: tokenRow.kind, event_type: 'matchdeal_pair_failed', failure_category: category });
    return json({ ok: false, error: 'MATCHDEAL_TOKEN_INVALID' }, 410);
  }
  if (new Date(tokenRow.expires_at) <= new Date()) {
    await admin.from('matchdeal_pairing_tokens').update({ status: 'expired' }).eq('id', tokenRow.id).eq('status', 'active');
    await logAudit(admin, { token_hash: tokenHash, token_org_id: tokenRow.org_id, attempted_by_user_id: user.id, result: 'expired' });
    await logEvent(admin, { organization_id: tokenRow.org_id, organization_type: tokenRow.kind, event_type: 'matchdeal_pair_failed', failure_category: 'expired' });
    return json({ ok: false, error: 'MATCHDEAL_TOKEN_EXPIRED' }, 410);
  }

  // Resolve the caller's OWN org for the token's kind — never trust a
  // client-supplied org. A founder token can only be consumed by a
  // session that's an org_members row for that same org; an investor
  // token only by a session with an active matchdeal_investor_members
  // link to that same catalog_entities row.
  let callerOrgId: string | null = null;
  if (tokenRow.kind === 'startup') {
    const { data } = await admin.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
    callerOrgId = (data?.org_id as string | undefined) ?? null;
  } else {
    const { data } = await admin.from('matchdeal_investor_members').select('catalog_entity_id').eq('user_id', user.id).eq('status', 'active').maybeSingle();
    callerOrgId = (data?.catalog_entity_id as string | undefined) ?? null;
  }

  if (!callerOrgId || callerOrgId !== tokenRow.org_id) {
    await logAudit(admin, { token_hash: tokenHash, token_org_id: tokenRow.org_id, attempted_by_user_id: user.id, attempted_org_id: callerOrgId, result: 'wrong_account' });
    await logEvent(admin, { organization_id: tokenRow.org_id, organization_type: tokenRow.kind, event_type: 'matchdeal_pair_failed', failure_category: 'wrong_account' });
    return json({ ok: false, error: 'MATCHDEAL_WRONG_ACCOUNT' }, 403);
  }

  // Atomic claim — same "WHERE status = 'active'" guard matchdeal-pair
  // already uses for its own device_links claim, so two concurrent
  // consume attempts for the same token can't both succeed.
  const { data: claimed } = await admin.from('matchdeal_pairing_tokens')
    .update({ status: 'used', used_at: new Date().toISOString(), used_by_device: deviceId })
    .eq('id', tokenRow.id).eq('status', 'active').select('id').maybeSingle();
  if (!claimed) {
    await logAudit(admin, { token_hash: tokenHash, token_org_id: tokenRow.org_id, attempted_by_user_id: user.id, result: 'already_used' });
    return json({ ok: false, error: 'MATCHDEAL_TOKEN_INVALID' }, 410);
  }

  const { data: pairing, error: pairingErr } = await admin.from('matchdeal_pairings').insert({
    org_id: tokenRow.org_id, kind: tokenRow.kind, user_id: user.id, device_id: deviceId,
  }).select('id, paired_at').single();
  if (pairingErr || !pairing) return json({ ok: false, error: 'Failed to record the pairing.', detail: pairingErr?.message }, 500);

  await logAudit(admin, { token_hash: tokenHash, token_org_id: tokenRow.org_id, attempted_by_user_id: user.id, attempted_org_id: callerOrgId, result: 'completed' });
  await logEvent(admin, { organization_id: tokenRow.org_id, organization_type: tokenRow.kind, event_type: 'matchdeal_pair_completed', source_of_action: 'manual' });

  return json({ ok: true, pairingId: pairing.id, pairedAt: pairing.paired_at });
});
