// Prompt 560 §B — the ONE route that turns a signed-in investor into an
// opened document, and the only one that can.
//
// The bug it closes, seen live: Actions required said "1 document to open".
// Nuno opened it from the **Data room** tab and the action stayed. It only
// cleared after opening the same document again from the startup profile's
// Documents tab. Two open paths existed and only one of them recorded
// anything:
//
//   * Documents tab      → POST /api/portal/view → a document_views row →
//                          the action clears, the founder's opens count moves.
//   * Data room tab      → <a href={d.url}> on a signed URL that
//                          /api/portal/access-granted had minted UP FRONT for
//                          every document in the list. No request on click,
//                          so nothing anywhere learned the document was read.
//
// That second path is not just unlogged, it is a leak of a different kind:
// a live signed URL for every document sat in the DOM from page load,
// whether or not the investor ever clicked one, and stayed valid for its
// full TTL after a revoke. Minting AT CLICK TIME fixes both at once.
//
// Deliberately a mirror of the guest open route (547 Part A.2) rather than a
// new shape: same re-read-the-grants-every-time rule, same "the id in the
// URL never decides anything" rule, same flagged-upload refusal, same
// best-effort logging that can never block the read. What differs is only
// the identity — a session email instead of a token — and that this one
// serves every shelf, because a signed-in investor with a confirmed grant
// has already passed the confirmation gate the guest route enforces.
//
// /api/portal/view stays for its other callers; it is simply no longer the
// only way a view gets recorded.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { descendantFolderIds, resolveDocumentAccess } from '@/lib/data-room';
import { grantStatus } from '@/lib/access-grants';
import { vaultFrozenForOrg } from '@/lib/data-room-server';
import { closedOrgGuard } from '@/lib/org-closed';

const SIGNED_URL_TTL_SECONDS = 300;
const NOINDEX_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

function refuse(reason: string, status: number) {
  return NextResponse.json({ ok: false, reason }, { status, headers: NOINDEX_HEADERS });
}

export async function GET(req: Request, { params }: { params: { documentId: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return refuse('not_configured', 503);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return refuse('sign_in_required', 401);

  const admin = createClient(url, service, {
    auth: { persistSession: false },
    // Never a cached grant: a founder's revoke has to take effect on the
    // next click, not at the end of some TTL.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const { data: doc } = await admin.from('documents')
    .select('id, name, folder_id, visibility, storage_path, external_url, malware_scan_status, org_id')
    .eq('id', params.documentId).maybeSingle();
  // A document that does not exist and one that is not shared with this
  // investor answer identically, on purpose.
  if (!doc) return refuse('not_found', 404);
  const orgId = doc.org_id as string;

  // Prompt 556 — a closed startup is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;

  // Prompt 278 §4 — "Close vault for everyone" applies here exactly as it
  // does to the guest route; a kill switch that one open path ignored would
  // not be a kill switch.
  if (await vaultFrozenForOrg(admin, orgId)) return refuse('frozen', 403);

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: rawGrants } = await admin.from('access_grants')
    .select('id, folder_id, document_id, nda_required, nda_accepted_at, expires_at, revoked_at, invited_email, confirmed_at')
    .eq('org_id', orgId).is('revoked_at', null).or(orParts.join(','));

  const now = new Date();
  // Same filter the portal's own listing uses: an expired grant shows in the
  // founder's panel but opens nothing.
  const grants = (rawGrants ?? []).filter((g) => grantStatus(g, now) !== 'expired' && grantStatus(g, now) !== 'revoked');
  if (grants.length === 0) return refuse('not_found', 404);

  const { data: orgFolders } = await admin.from('folders').select('id, parent_id').eq('org_id', orgId);
  const folderTree = (orgFolders ?? []).map((f) => ({
    id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined,
  }));

  // The document must be reachable through THIS investor's grants, decided
  // by the same resolver every other surface uses — never by "the id was in
  // the URL". resolveDocumentAccess also enforces the NDA gate, so a
  // document behind an unaccepted NDA lands in `pendingIds` and is refused
  // here with the reason that names the real next step.
  const { visibleIds, pendingIds } = resolveDocumentAccess(
    grants,
    [{ id: doc.id as string, folder_id: doc.folder_id as string | undefined, visibility: doc.visibility as string | undefined }],
    folderTree,
  );
  if (pendingIds.includes(doc.id as string)) return refuse('nda_required', 403);
  if (!visibleIds.includes(doc.id as string)) return refuse('not_found', 404);

  // Prompt 301 §3 — a flagged upload is never served to anyone but the
  // uploading org. Same refusal /api/portal/access-granted applies.
  if (doc.malware_scan_status === 'flagged') return refuse('unavailable', 403);

  let target: string | null = (doc.external_url as string | null) ?? null;
  if (!target && doc.storage_path) {
    const { data: signed } = await admin.storage.from('data-room')
      .createSignedUrl(doc.storage_path as string, SIGNED_URL_TTL_SECONDS);
    target = signed?.signedUrl ?? null;
  }
  if (!target) return refuse('unavailable', 404);

  // Logged before redirecting, and never allowed to block the open: the
  // founder's "who opened what" is worth a failed insert, not a failed read.
  //
  // grant_id carries the provenance and is resolved with the same
  // specificity rule /api/portal/view uses — a document-level grant wins
  // over the folder grant that also covers it — so the two paths produce
  // rows that are indistinguishable downstream. That is the point: Actions
  // required, the founder's opens count and the back-office join all read
  // document_views, and none of them should have to know which tab the
  // investor happened to click in.
  const grantId = grants.find((g) => g.document_id === doc.id)?.id
    ?? grants.find((g) => g.folder_id && descendantFolderIds(folderTree, [g.folder_id as string]).includes(doc.folder_id as string))?.id
    ?? grants[0]?.id ?? null;
  try {
    await admin.from('document_views').insert({
      org_id: orgId, document_id: doc.id, grant_id: grantId, viewer_email: email,
    });
  } catch { /* provenance is best-effort; the open is not */ }

  return NextResponse.redirect(target, { status: 302, headers: NOINDEX_HEADERS });
}
