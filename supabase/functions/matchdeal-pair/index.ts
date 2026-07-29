// MatchDeal — Edge Function: QR pairing.
//
// The ONLY Edge Function this app needs (per the integration adenda). It is
// the sole place the service role key is ever used for MatchDeal — never in
// the mobile client, never in a Next.js route on the connectB side (that
// project is not touched by this work at all).
//
// Called by the browser side (Sherlock Deal web, a future minimal prompt —
// not built here): the founder is already signed in there, scans or is
// shown the phone's QR (matchdeal://pair/<token>), and this function is
// called with that token plus the founder's own Sherlock Deal session.
//
// What it does, in order:
//   1. Verifies the caller IS a real, currently-authenticated Sherlock Deal
//      user (never trusts a client-supplied identity).
//   2. Atomically claims the pairing row — single UPDATE with
//      `used_at is null and expires_at > now()` in the WHERE clause, so two
//      concurrent calls for the same token can't both succeed (no
//      SELECT-then-UPDATE race).
//   3. Auto-imports the startup's matchdeal_profile from the org's Company
//      tab (orgs + company_people) — see mapTeam/mapOrgToProfile below.
//   4. Copies the org logo from the PRIVATE data-room bucket into the new
//      PUBLIC matchdeal bucket, so the mobile client can render it with a
//      plain <Image uri>, no signed-URL refresh logic needed on a phone.
//   5. Mints a one-time email code (Supabase generateLink) for the SAME
//      founder account — MatchDeal never creates a second identity — and
//      leaves it on the device_links row for the phone to redeem itself via
//      auth.verifyOtp(). See migration 0007 for why this is safe: the row
//      stays anonymously readable only because membership_id is
//      deliberately left null here; the phone sets it (and clears the code)
//      itself once it has a real session, via the existing update-own RLS
//      policy — no policy on this table is loosened for this to work.
//
// Captured retroactively (prompt 52, 2026-07-29) from the ACTIVE version
// (v1) already deployed in production — see supabase/migrations/
// 0053_retroactive_matchdeal_schema_capture.sql for the matching DB-side
// capture and its own notes, including the observation that a second,
// independent pairing path (matchdeal_pairing_seal/poll RPCs) also exists
// in the database and is not obviously the same flow as this function.
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// orgs.stage -> matchdeal investment_stage_sought. 'other' has no honest
// mapping (it exists in the Sherlock Deal enum precisely because the
// original four didn't fit) — left null rather than guessed, same
// "never invent a value" rule as the Prompt B backfill.
const STAGE_MAP: Record<string, string | null> = {
  pre_seed: 'pre_seed',
  seed: 'seed',
  series_a: 'series_a',
  later: 'series_b_plus',
  other: null,
};

function mapTeamSummary(people: any[]): string | null {
  const founders = people.filter((p) => p.is_founder);
  if (!founders.length) return null;
  return founders.map((p) => `${p.full_name}${p.title ? ` — ${p.title}` : ''}`).join('; ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'Sign in first.' }, 401);

  let body: { pairing_token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, 400);
  }
  const pairingToken = body.pairing_token?.trim();
  if (!pairingToken) return json({ ok: false, error: 'pairing_token is required.' }, 400);

  // The caller's own identity, verified — never taken from the request body.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: 'Not a valid Sherlock Deal session.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: membership } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return json({ ok: false, error: 'This account has no Sherlock Deal org.' }, 403);
  const orgId = membership.org_id as string;

  // Atomic claim: this WHERE clause is the entire "60-90s, single use"
  // guarantee. If two requests race for the same token, at most one gets a
  // row back — the loser gets MATCHDEAL_TOKEN_INVALID, not a double-pair.
  const { data: claimed, error: claimErr } = await admin
    .from('matchdeal_device_links')
    .update({ used_at: new Date().toISOString() })
    .eq('pairing_token', pairingToken)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  if (claimErr || !claimed) {
    return json({ ok: false, error: 'MATCHDEAL_TOKEN_INVALID', detail: 'Expired, already used, or unknown pairing code.' }, 410);
  }

  const { data: org } = await admin
    .from('orgs')
    .select('id, name, website, sectors, country, description, one_liner, stage, founded_year, round_target_eur, logo_url, sender_email')
    .eq('id', orgId)
    .single();
  const { data: people } = await admin
    .from('company_people')
    .select('full_name, title, is_founder')
    .eq('org_id', orgId);

  // Logo: copy from the PRIVATE data-room bucket into the PUBLIC matchdeal
  // bucket. A phone rendering a swipe deck can't be re-signing URLs on
  // every card; a public bucket sidesteps that entirely. The logo is a
  // company mark meant to be shown to third parties already — not
  // sensitive in the way the rest of the data room is.
  let photoUrl: string | null = null;
  if (org?.logo_url) {
    const { data: fileBlob } = await admin.storage.from('data-room').download(org.logo_url);
    if (fileBlob) {
      const ext = org.logo_url.split('.').pop() || 'png';
      const destPath = `${orgId}/profile-photo.${ext}`;
      const { error: uploadErr } = await admin.storage
        .from('matchdeal')
        .upload(destPath, fileBlob, { upsert: true, contentType: fileBlob.type || undefined });
      if (!uploadErr) {
        photoUrl = admin.storage.from('matchdeal').getPublicUrl(destPath).data.publicUrl;
      }
    }
  }

  const profilePatch = {
    membership_id: orgId,
    kind: 'startup',
    photo_url: photoUrl,
    website: org?.website ?? null,
    sectors: org?.sectors ?? [],
    country: org?.country ?? null,
    description: org?.description ?? org?.one_liner ?? null,
    investment_stage_sought: org?.stage ? STAGE_MAP[org.stage] ?? null : null,
    founded_year: org?.founded_year ?? null,
    target_round_amount: org?.round_target_eur ?? null,
    team_summary: mapTeamSummary(people ?? []),
    contact: org?.sender_email ?? null,
  };

  const { data: profile, error: profileErr } = await admin
    .from('matchdeal_profiles')
    .upsert(profilePatch, { onConflict: 'membership_id,kind' })
    .select('id, is_complete')
    .single();
  if (profileErr || !profile) {
    return json({ ok: false, error: 'Failed to create the MatchDeal profile.', detail: profileErr?.message }, 500);
  }

  // Mint the handoff. type: 'magiclink' against an email that ALREADY has
  // an account (every founder does) signs that same user in — this never
  // creates a second identity for the same person.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email!,
  });
  if (linkErr || !link) {
    return json({ ok: false, error: 'Failed to mint a session for the device.', detail: linkErr?.message }, 500);
  }

  await admin
    .from('matchdeal_device_links')
    .update({
      session_email: user.email,
      session_email_otp: (link.properties as any)?.email_otp ?? null,
      // membership_id is deliberately NOT set here — see migration 0007.
    })
    .eq('id', claimed.id);

  return json({
    ok: true,
    org_name: org?.name ?? null,
    profile_id: profile.id,
    profile_complete: profile.is_complete,
  });
});
