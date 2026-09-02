// Prompt 543 §A.2 — the one explicit act, where the founder already is.
//
// Copies the org's own fields into its startup matchdeal_profiles row.
// Migration 0105's trigger then computes is_complete, which flips
// is_visible. That is the whole publish: no new source of truth, no second
// form to fill in, and no auto-sync — Prompt 125 Block B rejected making
// visibility a side effect of completing a profile, so this only ever runs
// from a button the founder presses.
//
// The org fields and the profile columns are a strict mapping kept in
// src/lib/matchdeal-publish.ts, so what is copied is readable and testable
// in one place rather than inline here.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { type OrgRole } from '@/lib/permissions';
import { loadOrgMatrix } from '@/lib/org-matrix-server';
import { canWithMatrix } from '@/lib/org-permissions';
import { PLAN_TO_MATCHDEAL_TIER, normalizePlan } from '@/lib/plans';
import { matchdealPublishPayload, orgMatchdealMissing } from '@/lib/matchdeal-publish';
import type { Org } from '@/lib/types';

// Matches /api/matchdeal/photo's own SIGNED_URL_TTL_SECONDS and
// ProfilePanel's LOGO_SIGNED_URL_TTL_SECONDS — the value is STORED in
// photo_url and rendered directly by MatchDealDeck, so it has to outlive
// the profile rather than expire under it.
const LOGO_SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  // Same gate as /api/org/update — publishing writes the org's own public
  // face, so it is an org-editing act, not a separate permission.
  const matrix = await loadOrgMatrix(admin, member.org_id as string);
  if (!canWithMatrix(matrix, member.role as OrgRole, 'org_editing')) {
    return NextResponse.json({ ok: false, error: 'Your role can’t publish this company.' }, { status: 403 });
  }

  const { data: orgRow } = await admin.from('orgs').select('*').eq('id', member.org_id).maybeSingle();
  if (!orgRow) return NextResponse.json({ ok: false, error: 'Organisation not found.' }, { status: 404 });
  const org = orgRow as unknown as Org;

  // Checked against the ORG before writing anything: a publish that would
  // leave is_complete false should say which field is missing, not write a
  // half-profile and let the founder discover it from a badge.
  const missing = orgMatchdealMissing(org);
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, error: 'missing_fields', missingFields: missing }, { status: 400 });
  }

  // The logo lives in the private data-room bucket as a PATH; photo_url is
  // rendered directly by MatchDealDeck, so it needs a signed URL — exactly
  // what ProfilePanel's "Use your Sherlock Deal logo" already does, moved
  // server-side. Never re-uploaded and never rescanned: IdentityCard's
  // uploadAndVerifyFile (magic-byte allowlist + VirusTotal) already cleared
  // this exact object before orgs.logo_url was ever set.
  let photoUrl: string | null = null;
  if (org.logo_url) {
    const { data: signed } = await admin.storage.from('data-room').createSignedUrl(org.logo_url, LOGO_SIGNED_URL_TTL_SECONDS);
    photoUrl = signed?.signedUrl ?? null;
  }
  if (!photoUrl) {
    return NextResponse.json({
      ok: false, error: 'logo_unavailable',
      missingFields: [{ label: 'Logo', fieldId: 'identity.logo' }],
    }, { status: 400 });
  }

  const payload = matchdealPublishPayload(org, photoUrl);

  // Upsert, not update: the row should already exist (provision-org creates
  // it, migration 0299 backfilled the rest), but a founder who somehow has
  // none must still be able to publish rather than meet a second dead end.
  const { error } = await admin.from('matchdeal_profiles').upsert({
    membership_id: member.org_id, kind: 'startup',
    plan_tier: PLAN_TO_MATCHDEAL_TIER[normalizePlan(orgRow.plan as string | null)],
    ...payload,
  }, { onConflict: 'membership_id,kind' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Read back what the trigger decided rather than assuming it: is_complete
  // and is_visible are computed in Postgres, and reporting our own guess
  // here is how a UI ends up disagreeing with the database.
  const { data: after } = await admin.from('matchdeal_profiles')
    .select('is_complete, is_visible, owner_suspended_at, platform_suspended_at')
    .eq('membership_id', member.org_id).eq('kind', 'startup').maybeSingle();

  return NextResponse.json({
    ok: true,
    isComplete: !!after?.is_complete,
    isVisible: !!after?.is_visible,
    suspended: !!after?.owner_suspended_at,
    platformSuspended: !!after?.platform_suspended_at,
    missingFields: [],
  });
}
