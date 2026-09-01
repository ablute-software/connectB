// Item 1 (Lote E) — public, no-session resolution of a guest preview link.
// Public in middleware.ts (see that file's own note on why). Service-role
// only: an unauthenticated caller has no RLS identity to read access_grants
// or documents through, same reasoning as /api/portal/access.
//
// The one hard rule this route exists to enforce: never a signed URL, never
// document content. A guest token proves "someone was invited," not "this
// person may download files" — that still requires a real account and a
// confirmed grant (see /api/portal/confirm-identity, /api/portal/view).
//
// Prompt 171 §B.1 — was missing its own expiry check entirely: a grant past
// its expires_at kept showing its document in this preview forever, even
// though the real portal (post-login) already hid it. Now filtered before
// resolveDocumentAccess runs — see the comment at that filter's own site
// for why grantStatus's expiry check is reused here and not grantIsActive.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { descendantFolderIds, resolveDocumentAccess } from '@/lib/data-room';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { grantStatus } from '@/lib/access-grants';
import { vaultFrozenForOrg } from '@/lib/data-room-server';
import { GUEST_VISITOR_COOKIE, GUEST_VISITOR_COOKIE_MAX_AGE, newVisitorKey, recordGuestLinkView } from '@/lib/guest-link-views';

// This route reads no cookies/headers — unlike every other GET route in
// this app, which calls serverClient() first and reads a cookie, implicitly
// opting the whole request into dynamic rendering. Without cookies, the App
// Router's default is to treat plain fetch() calls (which is all
// supabase-js's REST client makes) as cacheable, and it does: confirmed
// live, an expired/revoked/confirmed grant kept resolving its ORIGINAL
// pre-change response indefinitely, `dynamic = 'force-dynamic'` alone did
// NOT fix it (verified after a full dev-server restart). The `global.fetch`
// override below forces every request this admin client makes to bypass
// Next's fetch cache directly, which is the layer actually caching it.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 200 });
  if (!(await guestGrantTokenAvailable())) return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 200 });

  const admin = createClient(url, service, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });

  const { data: grant } = await admin.from('access_grants').select('*')
    .eq('guest_token', params.token).is('revoked_at', null).maybeSingle();
  // Not found, revoked, or already confirmed (the account exists now — this
  // link's job is done, /portal is the right place from here) all read the
  // same to a caller who can't distinguish them from an invalid token
  // anyway; only "found but past guest_token_expires_at" gets its own
  // reason, since that's the one case with a real, actionable next step
  // ("ask the founder for a new one").
  if (!grant || grant.confirmed_at) return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 200 });
  if (!grant.guest_token_expires_at || new Date(grant.guest_token_expires_at as string) <= new Date()) {
    return NextResponse.json({ ok: false, reason: 'expired' }, { status: 200 });
  }

  const orgId = grant.org_id as string;
  const invitedEmail = grant.invited_email as string;

  const [{ data: org }, { data: profile }, { data: pendingGrants }] = await Promise.all([
    admin.from('orgs').select('name, one_liner').eq('id', orgId).single(),
    admin.from('matchdeal_profiles').select('photo_url, description').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle(),
    admin.from('access_grants').select('folder_id, document_id, nda_required, nda_accepted_at, expires_at')
      .eq('org_id', orgId).eq('invited_email', invitedEmail).is('confirmed_at', null).is('revoked_at', null),
  ]);
  if (!org) return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 200 });

  // Prompt 278 §4 — the kill switch, explicitly confirmed to cover this
  // route too: unlike every other gated path, this one shows folder/
  // document NAMES with no login at all, so "blank the metadata" here means
  // literally zero folders/names, not merely no signed URLs (which this
  // route never had anyway). Company identity (name/description/logo)
  // stays — that's not Vault content, it's the same public profile shown
  // regardless of documents.
  if (await vaultFrozenForOrg(admin, orgId)) {
    return NextResponse.json({
      ok: true, orgName: org.name as string,
      orgDescription: (org.one_liner as string | null) ?? (profile?.description as string | null) ?? null,
      orgLogoUrl: (profile?.photo_url as string | null) ?? null,
      invitedEmail, folders: [], documentNames: [], documentCount: 0, pendingNdaCount: 0,
    });
  }

  // Prompt 171 §B.1 — the bug: this route never checked an individual
  // grant's own expires_at at all, so an expired grant's document kept
  // appearing in the preview forever. NOT grantIsActive() here — every row
  // this query returns is, by construction, invited_email set + confirmed_at
  // null (a guest preview is inherently pre-confirmation), which grantStatus
  // always resolves to 'pending_confirmation' (never 'active') unless it's
  // expired first. grantIsActive() checks specifically for 'active', so it
  // would filter out EVERY row here, including perfectly valid ones — it's
  // calibrated for the real, post-login portal, not this pre-account
  // preview. grantStatus's own expiry check is the one piece actually
  // missing, so that's what's reused here — not a full status enum.
  const now = new Date();
  const grants = (pendingGrants ?? []).filter((g) => grantStatus(g, now) !== 'expired');
  // Prompt 204 §A — grant de pasta cobre a subarvore inteira.
  const { data: orgFolders } = await admin.from('folders').select('id, parent_id').eq('org_id', orgId);
  const folderTree = (orgFolders ?? []).map((f) => ({ id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined }));
  const folderIds = descendantFolderIds(folderTree, grants.filter((g) => g.folder_id).map((g) => g.folder_id as string));
  const directDocIds = grants.filter((g) => g.document_id).map((g) => g.document_id as string);
  const [{ data: docsInFolders }, { data: directDocs }] = await Promise.all([
    folderIds.length ? admin.from('documents').select('id, name, folder_id, visibility').in('folder_id', folderIds) : Promise.resolve({ data: [] }),
    directDocIds.length ? admin.from('documents').select('id, name, folder_id, visibility').in('id', directDocIds) : Promise.resolve({ data: [] }),
  ]);
  const docMap = new Map<string, { id: string; name: string; folder_id?: string; visibility?: string }>();
  for (const d of [...(docsInFolders ?? []), ...(directDocs ?? [])]) docMap.set(d.id as string, d as { id: string; name: string; folder_id?: string; visibility?: string });
  const candidateDocs = [...docMap.values()];

  // Same visibility rule /api/portal/access-granted uses (document-level
  // grant overrides its folder's, NDA-gated docs stay hidden) — a guest
  // preview should never claim to show more than the real portal will once
  // they're actually signed in. `pendingCount` (NDA-gated, not yet
  // accepted) rides along so the client can tell "nothing shared" apart
  // from "shared, but all pending NDA" (§ Nota — partilha com NDA) instead
  // of rendering an unexplained empty folder either way.
  const { visibleIds, pendingCount } = resolveDocumentAccess(grants, candidateDocs, folderTree);
  const visibleDocs = candidateDocs.filter((d) => visibleIds.includes(d.id));

  // Prompt 154 gap 2 — the real folder/document tree, not just a flat
  // sorted name list: every visible document already carries its real
  // folder_id (documents always belong to a folder), so this is a lookup +
  // group, not a new query shape. Still never a signed URL or document
  // content — same hard rule this route's own header states; only names
  // and structure cross this boundary.
  const treeFolderIds = [...new Set(visibleDocs.map((d) => d.folder_id).filter(Boolean))] as string[];
  const { data: folderRows } = treeFolderIds.length
    ? await admin.from('folders').select('id, name').in('id', treeFolderIds)
    : { data: [] };
  const folderNameById = new Map((folderRows ?? []).map((f) => [f.id as string, f.name as string]));
  const docsByFolder = new Map<string, { id: string; name: string }[]>();
  for (const d of visibleDocs) {
    const key = d.folder_id ?? '';
    const list = docsByFolder.get(key) ?? [];
    list.push({ id: d.id, name: d.name });
    docsByFolder.set(key, list);
  }
  const folders = [...docsByFolder.entries()]
    .filter(([folderId]) => folderId && folderNameById.has(folderId))
    .map(([folderId, documents]) => ({
      id: folderId, name: folderNameById.get(folderId)!,
      documents: documents.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const documentNames = visibleDocs.map((d) => d.name).sort();

  const res = NextResponse.json({
    ok: true,
    orgName: org.name as string,
    orgDescription: (org.one_liner as string | null) ?? (profile?.description as string | null) ?? null,
    orgLogoUrl: (profile?.photo_url as string | null) ?? null,
    invitedEmail,
    folders,
    documentNames,
    documentCount: documentNames.length,
    pendingNdaCount: pendingCount,
  });

  // Prompt 526 Part C — record that this link was opened, and from how many
  // distinct browsers. Deliberately AFTER the response body is built and never
  // awaited into the caller's critical path in a way that could fail it: a
  // legitimate visitor must never be denied the data room because bookkeeping
  // broke. The cookie is opaque, first-party and random — it distinguishes "one
  // person reloading" from "a second device" and identifies nobody. No IP is
  // read or stored anywhere; see guest-link-views.ts for why.
  const existingKey = _req.headers.get('cookie')?.match(/(?:^|;\s*)sd_guest_visitor=([a-f0-9]{32})/)?.[1];
  const visitorKey = existingKey ?? newVisitorKey();
  if (!existingKey) {
    res.cookies.set(GUEST_VISITOR_COOKIE, visitorKey, {
      httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: GUEST_VISITOR_COOKIE_MAX_AGE,
    });
  }
  await recordGuestLinkView(admin, grant.id as string, visitorKey);

  return res;
}
