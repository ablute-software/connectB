// Prompt 547 Part A.2 — the only route that turns a guest token into an
// openable document, and it opens exactly one shelf.
//
// Deliberately a SEPARATE FILE from ../../route.ts. That file is contested
// between main and claude/prompt-518-reconciled (537 hardened it, 526 Part C
// logs views in it), so the changes there stay additive and the whole of this
// new behaviour lives here instead — the 518 rebase should not have to reason
// about it.
//
// Every refusal this can produce, and why each one exists:
//   nda_required           — the founder marked it; the shelf does not override that
//   confirmation_required  — Data Room, which keeps 526's non-transferability
//   invalid / expired      — the token itself (same semantics as the listing route)
//   frozen                 — "Close vault for everyone" (vault_access_frozen_at)
//   rate_limited           — 537 §4.2, before any lookup
//
// Nothing is cached. Grants are re-read on every call, so a founder's revoke
// takes effect on the next click rather than at the end of some TTL — that is
// the property the founder is promised on their own side of this.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { descendantFolderIds, resolveDocumentAccess } from '@/lib/data-room';
import { decideGuestOpen, shelfFromFolderKind, GUEST_SIGNED_URL_TTL_SECONDS } from '@/lib/guest-shelf';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { grantStatus } from '@/lib/access-grants';
import { vaultFrozenForOrg } from '@/lib/data-room-server';
import { clientIp, findGrantByGuestToken, guestLinkRateLimited } from '@/lib/guest-link-security';

const NOINDEX_HEADERS = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

function refuse(reason: string, status: number) {
  return NextResponse.json({ ok: false, reason }, { status, headers: NOINDEX_HEADERS });
}

export async function GET(
  req: Request,
  { params }: { params: { token: string; documentId: string } },
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return refuse('invalid', 403);
  if (!(await guestGrantTokenAvailable())) return refuse('invalid', 403);

  const admin = createClient(url, service, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  // 537 §4.2 — before any lookup, so enumeration pays the limit, not the DB.
  if (await guestLinkRateLimited(admin, clientIp(req))) return refuse('rate_limited', 429);

  const { grant } = await findGrantByGuestToken(admin, params.token);
  if (!grant || grant.confirmed_at) return refuse('invalid', 403);
  if (!grant.guest_token_expires_at || new Date(grant.guest_token_expires_at as string) <= new Date()) {
    // 410 rather than 403: the link WAS valid, and "ask the founder for a new
    // one" is a real next step, unlike every other refusal here.
    return refuse('expired', 410);
  }

  const orgId = grant.org_id as string;
  const invitedEmail = grant.invited_email as string;
  if (await vaultFrozenForOrg(admin, orgId)) return refuse('frozen', 403);

  // Re-read every grant for this recipient, exactly as the listing route
  // does. The token identifies WHO; it never carries what they may see.
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

  const { data: doc } = await admin
    .from('documents')
    .select('id, name, folder_id, visibility, storage_path, external_url, malware_scan_status, org_id')
    .eq('id', params.documentId).maybeSingle();
  // Cross-org is indistinguishable from "not shared with you", on purpose.
  if (!doc || doc.org_id !== orgId) return refuse('invalid', 403);

  // The document must be reachable through THIS recipient's grants, decided
  // by the same resolver the portal uses — never by "the id was in the URL".
  const { visibleIds } = resolveDocumentAccess(
    grants,
    [{ id: doc.id as string, folder_id: doc.folder_id as string | undefined, visibility: doc.visibility as string | undefined }],
    folderTree,
  );
  if (!visibleIds.includes(doc.id as string)) return refuse('confirmation_required', 403);

  const ndaFolderIds = new Set(
    descendantFolderIds(folderTree, grants.filter((g) => g.nda_required && g.folder_id).map((g) => g.folder_id as string)),
  );
  const ndaDocIds = new Set(grants.filter((g) => g.nda_required && g.document_id).map((g) => g.document_id as string));
  const ndaRequired = ndaDocIds.has(doc.id as string)
    || (!!doc.folder_id && ndaFolderIds.has(doc.folder_id as string));

  const decision = decideGuestOpen({
    shelf: shelfFromFolderKind(kindByFolderId.get(doc.folder_id as string) ?? null),
    ndaRequired,
  });
  if (!decision.allowed) return refuse(decision.reason, 403);

  // Same refusal /api/portal/access-granted applies: a flagged upload is not
  // served to anyone but the uploading org.
  if (doc.malware_scan_status === 'flagged') return refuse('invalid', 403);

  let target: string | null = (doc.external_url as string | null) ?? null;
  if (!target && doc.storage_path) {
    const { data: signed } = await admin.storage
      .from('data-room')
      .createSignedUrl(doc.storage_path as string, GUEST_SIGNED_URL_TTL_SECONDS);
    target = signed?.signedUrl ?? null;
  }
  if (!target) return refuse('invalid', 403);

  // Logged before redirecting, and never allowed to block the open: the
  // founder's "who opened what" is worth a failed insert, not a failed read.
  // document_views has no `source` column (checked against production), so
  // grant_id carries the provenance — it is the guest grant, which is exactly
  // what distinguishes this from a signed-in investor's view.
  try {
    await admin.from('document_views').insert({
      org_id: orgId, document_id: doc.id, grant_id: grant.id, viewer_email: invitedEmail,
    });
  } catch { /* provenance is best-effort; the open is not */ }

  return NextResponse.redirect(target, { status: 302, headers: NOINDEX_HEADERS });
}
