// Prompt 742 §D.2 — the investor viewer page's own access-check + mint
// route. Deliberately mirrors /api/portal/open/[documentId]'s access logic
// (same re-read-the-grants-every-time rule, same checks, same refusal
// shapes) rather than sharing code across the two — this codebase's own
// established convention for this exact investor/guest, GET/POST family
// (see that route's own header comment: "a mirror... rather than a new
// shape"). What differs here: this returns JSON instead of redirecting,
// and it is what actually inserts document_views + the signal event for
// pdf/image/embed opens — the GET open route, once it redirects a
// non-external document here, does NOT insert a second time.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { descendantFolderIds, resolveDocumentAccess } from '@/lib/data-room';
import { grantStatus } from '@/lib/access-grants';
import { vaultFrozenForOrg } from '@/lib/data-room-server';
import { closedOrgGuard } from '@/lib/org-closed';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { recordInvestorSignalForEntity } from '@/lib/investor-signal-events-server';
import { documentNdaByDefaultAvailable } from '@/lib/documents-nda-default-capability';
import { googlePreviewUrl, resolveViewerKind, VIEWER_KIND_LABEL } from '@/lib/document-viewer';

const SIGNED_URL_TTL_SECONDS = 300;

function refuse(reason: string, status: number) {
  return NextResponse.json({ ok: false, reason }, { status });
}

export async function POST(req: Request, { params }: { params: { documentId: string } }) {
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

  const ndaByDefaultOn = await documentNdaByDefaultAvailable();
  const docSelect: string = `id, name, folder_id, visibility, storage_path, external_url, malware_scan_status, org_id, watermark, downloadable${ndaByDefaultOn ? ', nda_by_default' : ''}`;
  const { data: rawDoc } = await admin.from('documents')
    .select(docSelect)
    .eq('id', params.documentId).maybeSingle();
  const doc = rawDoc as unknown as {
    id: string; name: string; folder_id?: string; visibility?: string; storage_path?: string;
    external_url?: string; malware_scan_status?: string; org_id: string; nda_by_default?: boolean;
    watermark: boolean; downloadable: boolean;
  } | null;
  if (!doc) return refuse('not_found', 404);
  const orgId = doc.org_id;

  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  if (await vaultFrozenForOrg(admin, orgId)) return refuse('frozen', 403);

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: rawGrants } = await admin.from('access_grants')
    .select('id, folder_id, document_id, nda_required, nda_accepted_at, expires_at, revoked_at, invited_email, confirmed_at')
    .eq('org_id', orgId).is('revoked_at', null).or(orParts.join(','));

  const now = new Date();
  const grants = (rawGrants ?? []).filter((g) => grantStatus(g, now) !== 'expired' && grantStatus(g, now) !== 'revoked');
  if (grants.length === 0) return refuse('not_found', 404);

  const { data: orgFolders } = await admin.from('folders').select('id, parent_id').eq('org_id', orgId);
  const folderTree = (orgFolders ?? []).map((f) => ({
    id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined,
  }));

  const { visibleIds, pendingIds } = resolveDocumentAccess(
    grants,
    [{ id: doc.id, folder_id: doc.folder_id, visibility: doc.visibility, nda_by_default: doc.nda_by_default }],
    folderTree,
  );
  if (pendingIds.includes(doc.id)) return refuse('nda_required', 403);
  if (!visibleIds.includes(doc.id)) return refuse('not_found', 404);
  if (doc.malware_scan_status === 'flagged') return refuse('unavailable', 403);

  const kind = resolveViewerKind(doc);
  let target: string | null = null;
  if (kind === 'embed') {
    target = doc.external_url ? googlePreviewUrl(doc.external_url) : null;
  } else if (doc.storage_path) {
    // D.2 — the file never passes through a Vercel function (the ~4.5 MB
    // response cap a deck routinely exceeds): this is a short-lived signed
    // URL the client (pdfjs, or a plain <img>) fetches directly from
    // Supabase Storage. CORS confirmed open on this project's Storage API
    // (Access-Control-Allow-Origin: *, checked directly against the real
    // endpoint before building this) — never proxy instead if that ever
    // changes; stop and report.
    const { data: signed } = await admin.storage.from('data-room')
      .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    target = signed?.signedUrl ?? null;
  }
  if (!target) return refuse('unavailable', 404);

  const grantId = grants.find((g) => g.document_id === doc.id)?.id
    ?? grants.find((g) => g.folder_id && descendantFolderIds(folderTree, [g.folder_id as string]).includes(doc.folder_id as string))?.id
    ?? grants[0]?.id ?? null;
  let viewId: string | null = null;
  try {
    const { data: inserted } = await admin.from('document_views').insert({
      org_id: orgId, document_id: doc.id, grant_id: grantId, viewer_email: email,
    }).select('id').single();
    viewId = (inserted?.id as string) ?? null;
  } catch { /* provenance is best-effort; the open is not */ }

  // Prompt 741 §B.2 — same signal-ledger twin as the open route's own.
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (investorCatalogEntityId) {
    const ndaRequired = grants.find((g) => g.id === grantId)?.nda_required ?? false;
    const dedupDay = now.toISOString().slice(0, 10);
    await recordInvestorSignalForEntity(admin, {
      investorCatalogEntityId, orgId, actorUserId: user.id, level: 'avaliacao_substantiva', kind: 'document_opened',
      snapshot: { document_id: doc.id, visibility: doc.visibility, nda_required: ndaRequired, via: 'view_route' },
      dedupKey: `${investorCatalogEntityId}:${orgId}:document_opened:${doc.id}:${user.id}:${dedupDay}`,
    });
  }

  return NextResponse.json({
    ok: true, viewId, kind, url: target, name: doc.name,
    watermark: doc.watermark, downloadable: doc.downloadable, viewerLabel: VIEWER_KIND_LABEL[kind],
    // D.4 — the watermark overlay needs the reader's own email; returned
    // here so the client never has to make a second /api/me round trip
    // (and so the guest viewer, which has no session/api/me at all, can
    // use the exact same page component).
    viewerEmail: email,
  });
}
