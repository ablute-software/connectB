// Prompt 918 D — the logo of a VERIFIED badge, streamed to an investor from our own origin (badge-logo-proxy.ts says why: no Storage
// URL, and no third-party host ever learns which investor opened which dossier).
//
// The gate is the dossier's own, no stricter and no looser: badges are shown at every disclosure level (projectDossier has no level
// floor for them), so this route needs the same two things the media route needs for a company photo — the investor is linked to the
// startup at all (resolveInvestorOrgEligibility, the Stage-1 union without Stage 2's writes) and the org is not closed — plus the one
// thing specific to badges: the badge itself must be VERIFIED with a public source. An unverified badge's logo is as private as the
// badge, and "not found" is the answer for all of these, indistinguishable from an id that does not exist.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { closedOrgGuard } from '@/lib/org-closed';
import { resolveInvestorOrgEligibility } from '@/lib/investor-pipeline';
import { serveBadgeLogo } from '@/lib/badge-logo-proxy';
import { normalizeSourceUrl } from '@/lib/company-badges';

export const runtime = 'nodejs';

const NOINDEX_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

function refuse(reason: string, status: number) {
  return NextResponse.json({ ok: false, reason }, { status, headers: NOINDEX_HEADERS });
}

export async function GET(req: Request, { params }: { params: { badgeId: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return refuse('not_configured', 503);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return refuse('sign_in_required', 401);

  const admin = createClient(url, service, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const { data: badge } = await admin.from('company_badges')
    .select('org_id, verification_status, source_url, verified_at, logo_storage_path, logo_url')
    .eq('id', params.badgeId).maybeSingle();
  // Same-shape refusal for "doesn't exist", "not verified" and "not shared with you".
  if (!badge || badge.verification_status !== 'verified' || !normalizeSourceUrl(badge.source_url) || !badge.verified_at) return refuse('not_found', 404);

  const orgId = badge.org_id as string;
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;

  const { eligible } = await resolveInvestorOrgEligibility(admin, user.id, email, orgId);
  if (!eligible) return refuse('not_found', 404);

  return serveBadgeLogo({
    admin, req,
    badge: { org_id: orgId, logo_storage_path: (badge.logo_storage_path as string | null) ?? null, logo_url: (badge.logo_url as string | null) ?? null },
  });
}
