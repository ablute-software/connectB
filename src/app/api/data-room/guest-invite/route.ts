// Item 1 (Lote E) — mints the guest-preview token for an invite grant.
// Called right after the "+ Invite someone new" flow creates the
// pending_confirmation access_grants row(s) for an email (documents/
// page.tsx's submitGrantTree). Per Nuno's own confirmed decision
// (2026-08-07): this fills access_grants.guest_token/guest_token_expires_at
// — the two columns migration 0114 already added for exactly this — in the
// same row an invite already creates, rather than a separate table. Token
// generation itself stays server-side (never in the browser), same
// mechanism as MatchDeal's pairing tokens (matchdeal-pairing.ts):
// crypto-random, opaque, never derived from the email or the grant id.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { generateRawToken } from '@/lib/matchdeal-pairing';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';

// Decision (2026-08-07, per the mini-prompt's own ask to pick and record
// one): 14 days. Long enough that "I'll look at this later" doesn't expire
// before the investor gets to it, short enough that a stale, unconfirmed
// invite doesn't stay guessable-and-valid indefinitely.
const GUEST_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// The client-side access_grants insert (store-supabase.tsx's addGrant) is a
// fire-and-forget browser write, not awaited by its caller — this route can
// run before that insert has actually landed. A few short retries covers
// the real-world gap without the caller having to change how addGrant works.
const RESOLVE_RETRIES = 5;
const RESOLVE_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });
  if (!(await guestGrantTokenAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { orgId, invitedEmail } = await req.json().catch(() => ({})) as { orgId?: string; invitedEmail?: string };
  const email = invitedEmail?.trim().toLowerCase();
  if (!orgId || !email) return NextResponse.json({ ok: false, error: 'orgId and invitedEmail are required.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Idempotent by design — this is also what the "Copy guest link" button
  // calls (documents/page.tsx), any time after the invite, not just once at
  // creation. A grant that already has a live token gets it handed back
  // unchanged rather than silently rotated (a previously-shared link should
  // keep working); an expired one gets a fresh token + expiry.
  type PendingGrant = { id: string; guest_token: string | null; guest_token_expires_at: string | null };
  let grant: PendingGrant | null = null;
  for (let attempt = 0; attempt < RESOLVE_RETRIES; attempt++) {
    const { data } = await admin.from('access_grants').select('id, guest_token, guest_token_expires_at')
      .eq('org_id', orgId).eq('invited_email', email).is('confirmed_at', null).is('revoked_at', null)
      .order('granted_at', { ascending: false }).limit(1).maybeSingle();
    if (data) { grant = data as PendingGrant; break; }
    await sleep(RESOLVE_DELAY_MS);
  }
  if (!grant) return NextResponse.json({ ok: false, error: 'No pending invite found for that email yet.' }, { status: 404 });

  const stillLive = grant.guest_token && grant.guest_token_expires_at && new Date(grant.guest_token_expires_at) > new Date();
  if (stillLive) return NextResponse.json({ ok: true, token: grant.guest_token, expiresAt: grant.guest_token_expires_at });

  const token = generateRawToken();
  const expiresAt = new Date(Date.now() + GUEST_TOKEN_TTL_MS).toISOString();
  const { error } = await admin.from('access_grants')
    .update({ guest_token: token, guest_token_expires_at: expiresAt })
    .eq('id', grant.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, token, expiresAt });
}
