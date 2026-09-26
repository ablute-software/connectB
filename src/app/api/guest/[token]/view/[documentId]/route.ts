// Prompt 742 §D.2 — the guest viewer page's own access-check + mint route.
// Mirrors /api/guest/[token]/open/[documentId]'s exact access logic (same
// rate limit, same token/grant re-read, same NDA-before-visibility
// ordering, same confirmation-required gate) rather than sharing code —
// same "mirror, not a new shape" convention that pair already documents in
// its own header. Returns JSON instead of redirecting, and owns the
// document_views insert for pdf/image/embed opens reached through it.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { descendantFolderIds, resolveDocumentAccess } from '@/lib/data-room';
import { decideGuestOpen, shelfFromFolderKind } from '@/lib/guest-shelf';
import { documentNdaByDefaultAvailable } from '@/lib/documents-nda-default-capability';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { grantStatus } from '@/lib/access-grants';
import { vaultFrozenForOrg } from '@/lib/data-room-server';
import { clientIp, findGrantByGuestToken, guestLinkRateLimited } from '@/lib/guest-link-security';
import { googlePreviewUrl, resolveViewerKind, VIEWER_KIND_LABEL } from '@/lib/document-viewer';

const SIGNED_URL_TTL_SECONDS = 300;

function refuse(reason: string, status: number) {
  return NextResponse.json({ ok: false, reason }, { status });
}

export async function POST(req: Request, { params }: { params: { token: string; documentId: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return refuse('invalid', 403);
  if (!(await guestGrantTokenAvailable())) return refuse('invalid', 403);

  const admin = createClient(url, service, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  if (await guestLinkRateLimited(admin, clientIp(req))) return refuse('rate_limited', 429);

  const { grant } = await findGrantByGuestToken(admin, params.token);
  if (!grant || grant.confirmed_at) return refuse('invalid', 403);
  if (!grant.guest_token_expires_at || new Date(grant.guest_token_expires_at as string) <= new Date()) {
    return refuse('expired', 410);
  }

  const orgId = grant.org_id as string;
  const invitedEmail = grant.invited_email as string;
  if (await vaultFrozenForOrg(admin, orgId)) return refuse('frozen', 403);

  const { data: pendingGrants } = await admin
    .from('access_grants').select('id, folder_id, document_id, nda_required, nda_accepted_at, expires_at')
    .eq('org_id', orgId).eq('invited_email', invitedEmail)
    .is('confirmed_at', null).is('revoked_at', null);

  const now = new Date();
  const grants = (pendingGrants ?? []).filter((g) => grantStatus(g, now) !== 'expired');
  if (grants.length === 0) return refuse('invalid', 403);

  const { data: orgFolders } = await admin.from('folders').select('id, parent_id, kind').eq('org_id', orgId);
  const folderTree = (orgFolders ?? []).map((f) => ({
    id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined,
  }));
  const kindByFolderId = new Map((orgFolders ?? []).map((f) => [f.id as string, f.kind as string | null]));

  const ndaByDefaultOn = await documentNdaByDefaultAvailable();
  const docSelect: string = `id, name, folder_id, visibility, storage_path, external_url, malware_scan_status, org_id, watermark, downloadable${ndaByDefaultOn ? ', nda_by_default' : ''}`;
  const { data: rawDoc } = await admin.from('documents').select(docSelect).eq('id', params.documentId).maybeSingle();
  const doc = rawDoc as unknown as {
    id: string; name: string; folder_id?: string; visibility?: string; storage_path?: string;
    external_url?: string; malware_scan_status?: string; org_id: string; nda_by_default?: boolean;
    watermark: boolean; downloadable: boolean;
  } | null;
  if (!doc || doc.org_id !== orgId) return refuse('invalid', 403);

  // NDA decided before visibility — same load-bearing order the GET route's
  // own comment explains (resolveDocumentAccess hides an NDA-pending
  // document as unresolvable rather than pending, so checking visibility
  // first would report the wrong reason).
  const ndaFolderIds = new Set(
    descendantFolderIds(folderTree, grants.filter((g) => g.nda_required && g.folder_id).map((g) => g.folder_id as string)),
  );
  const ndaDocIds = new Set(grants.filter((g) => g.nda_required && g.document_id).map((g) => g.document_id as string));
  const ndaRequired = ndaDocIds.has(doc.id) || (!!doc.folder_id && ndaFolderIds.has(doc.folder_id));
  const decision = decideGuestOpen({ shelf: shelfFromFolderKind(kindByFolderId.get(doc.folder_id ?? '') ?? null), ndaRequired });
  if (!decision.allowed) return refuse(decision.reason, 403);

  const { visibleIds } = resolveDocumentAccess(
    grants,
    [{ id: doc.id, folder_id: doc.folder_id, visibility: doc.visibility, nda_by_default: doc.nda_by_default }],
    folderTree,
  );
  if (!visibleIds.includes(doc.id)) return refuse('confirmation_required', 403);
  if (doc.malware_scan_status === 'flagged') return refuse('invalid', 403);

  const kind = resolveViewerKind(doc);
  let target: string | null = null;
  if (kind === 'embed') {
    target = doc.external_url ? googlePreviewUrl(doc.external_url) : null;
  } else if (doc.storage_path) {
    const { data: signed } = await admin.storage.from('data-room').createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    target = signed?.signedUrl ?? null;
  }
  if (!target) return refuse('invalid', 404);

  try {
    const { data: inserted } = await admin.from('document_views').insert({
      org_id: orgId, document_id: doc.id, grant_id: grant.id, viewer_email: invitedEmail,
    }).select('id').single();
    return NextResponse.json({
      ok: true, viewId: (inserted?.id as string) ?? null, kind, url: target, name: doc.name,
      watermark: doc.watermark, downloadable: doc.downloadable, viewerLabel: VIEWER_KIND_LABEL[kind], viewerEmail: invitedEmail,
    });
  } catch {
    // provenance is best-effort; the open is not — still return the viewer
    // payload even if the log insert itself failed.
    return NextResponse.json({
      ok: true, viewId: null, kind, url: target, name: doc.name,
      watermark: doc.watermark, downloadable: doc.downloadable, viewerLabel: VIEWER_KIND_LABEL[kind], viewerEmail: invitedEmail,
    });
  }
}
