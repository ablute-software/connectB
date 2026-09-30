// Prompt 750 — the company_media twin of /api/portal/open/[documentId]:
// dossier-fetch.ts used to mint a live Supabase Storage signed URL for every
// photo/video (mini-pitch slide images, and the company/technology/team
// gallery) and embed it directly in the dossier JSON sent to the browser —
// same bearer-link shape as the documents leak this prompt fixes elsewhere,
// just for media instead of documents. This route streams the bytes
// instead; see document-proxy.ts and DECISIONS.md, Prompt 750.
//
// Gate, deliberately the minimum that matches what projectDossier already
// decides (investor-interest-level.ts): a 'team' category item requires
// level >= 2, same as the Team section's own gate; everything else
// (company/technology gallery items, and mini-pitch slide images) requires
// only that this investor is LINKED to the org at all — no `level >=`
// condition guards aboutMedia in projectDossier, so requiring one here
// would be a functional regression (a level-0 investor's own dossier
// legitimately shows those images today).
//
// Known, accepted narrow gap, stated plainly rather than silently accepted:
// a media row that backs a mini-pitch slide but is not itself categorized
// 'team' is servable through this route at level 0 even though the
// mini-pitch array itself only appears in the dossier JSON at level >= 1
// (projectDossier's own `if (level >= 1 && miniPitch...)`). The id is an
// unguessable UUID scoped to one org, so this is not a practical
// enumeration risk — but it is a real, if narrow, mismatch between "what
// the JSON shows" and "what a direct request to this route can fetch",
// worth fixing precisely in a follow-up rather than folding an
// under-verified special case into this already security-critical route.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { closedOrgGuard } from '@/lib/org-closed';
import { getPipelineWaves } from '@/lib/investor-pipeline';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { currentInterestLevel } from '@/lib/investor-interest-level';
import { getInterestLevelRows } from '@/lib/investor-interest-level-db';
import { interestLevelAvailable } from '@/lib/investor-interest-level-capability';
import { shouldLogOpen, streamStorageObject } from '@/lib/document-proxy';
import { recordInvestorSignalForEntity } from '@/lib/investor-signal-events-server';

export const runtime = 'nodejs';

const NOINDEX_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

function refuse(reason: string, status: number) {
  return NextResponse.json({ ok: false, reason }, { status, headers: NOINDEX_HEADERS });
}

export async function GET(req: Request, { params }: { params: { mediaId: string } }) {
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

  const { data: media } = await admin.from('company_media')
    .select('id, kind, category, caption, storage_path, external_url, malware_scan_status, org_id')
    .eq('id', params.mediaId).maybeSingle();
  // Same-shape refusal for "doesn't exist" and "not shared with you" —
  // matches every other route in this prompt.
  if (!media) return refuse('not_found', 404);
  if (!['clean', 'local_only'].includes(media.malware_scan_status as string)) return refuse('unavailable', 403);

  const orgId = media.org_id as string;
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;

  // Eligibility: the same "is this investor linked to this org at all"
  // check /api/portal/startup/[orgId] itself gates the whole dossier on —
  // an org this investor has no relationship with is indistinguishable
  // from a media id that doesn't exist.
  const result = await getPipelineWaves(sb, admin, user.id, email);
  const card = result.linked ? result.waves.flatMap((w) => w.items).find((c) => c.orgId === orgId) : null;
  if (!card) return refuse('not_found', 404);

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  const decisionForLevel: 'interested' | 'passed' | null =
    card.status === 'passed' ? 'passed' : card.status === 'interested' ? 'interested' : null;
  const levelRows = investorCatalogEntityId && await interestLevelAvailable()
    ? await getInterestLevelRows(admin, orgId, investorCatalogEntityId) : [];
  const level = currentInterestLevel(decisionForLevel, levelRows);

  // Team photos ride with the Team section's own level>=2 gate
  // (investor-interest-level.ts's projectDossier) — never a second,
  // different threshold here. Company/technology gallery items and
  // mini-pitch slide images have no level floor in projectDossier, so none
  // is enforced here either (see this file's own header comment).
  if (media.category === 'team' && level < 2) return refuse('not_found', 404);

  if (media.kind === 'video_link') {
    // Not actually storage-backed — dossier-fetch.ts never points a
    // video_link item at this route, but refuse safely rather than crash
    // if one ever does.
    if (!media.external_url) return refuse('unavailable', 404);
    return NextResponse.redirect(media.external_url as string, { status: 302, headers: NOINDEX_HEADERS });
  }
  if (!media.storage_path) return refuse('unavailable', 404);

  if (shouldLogOpen(req)) {
    // Best-effort, mirrors the same signal document opens write — worth a
    // failed insert, never a failed read.
    if (investorCatalogEntityId) {
      const dedupDay = new Date().toISOString().slice(0, 10);
      try {
        await recordInvestorSignalForEntity(admin, {
          investorCatalogEntityId, orgId, actorUserId: user.id, level: 'envolvimento', kind: 'media_opened',
          snapshot: { media_id: media.id, category: media.category, kind: media.kind },
          dedupKey: `${investorCatalogEntityId}:${orgId}:media_opened:${media.id}:${user.id}:${dedupDay}`,
        });
      } catch { /* best-effort */ }
    }
  }

  const filename = (media.storage_path as string).split('/').pop() || (media.caption as string) || media.id as string;
  return streamStorageObject({ admin, storagePath: media.storage_path as string, filename, req });
}
