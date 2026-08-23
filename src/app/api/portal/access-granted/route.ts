// Investor Workspace — "Data room" (Prompt 121 §2.5, renamed and grown by
// Prompt 337/338 into the read-only mirror of the founder's own Vault Data
// Room, from the investor's side: everything startups opened to them,
// nothing they can share onward). Distinct from /api/portal/access (which
// resolves ONE org's data room for the startup-card view, per Prompt 120
// Block A's routing): this route surfaces EVERY startup this investor has
// ever held a grant for, split into Granted (currently active), Requested,
// and Expired.
//
// Prompt 338 — the Granted tab's own convergence fix: this used to filter
// candidate documents down to resolveDocumentAccess's visibleIds ONLY,
// silently dropping any document still waiting on a signed NDA. Now every
// candidate document a grant covers is returned, marked `locked` when its
// effective grant is nda_required and not yet accepted (data-room-
// investor-view.ts's pure effectiveGrantForDoc/isDocLocked — same
// precedence resolveDocumentAccess itself uses, document-level over
// folder-level) — "listed but locked," never silently hidden, per the
// prompt's own instruction. A locked document never gets a signed URL.
//
// "new since your last visit" — data_room_last_seen_at (migration 0224,
// one column on matchdeal_investor_members, one row per real investor
// identity already) is read BEFORE computing isNew, then stamped to now()
// at the end of this same request — simple, no separate "mark seen" call.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { grantStatus, grantIsActive, type GrantStatusInput } from '@/lib/access-grants';
import { descendantFolderIds, resolveDocumentAccess } from '@/lib/data-room';
import { vaultFrozenForOrg } from '@/lib/data-room-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { currentInterestLevel, type InterestLevel } from '@/lib/investor-interest-level';
import { getInterestLevelRows } from '@/lib/investor-interest-level-db';
import { interestLevelAvailable } from '@/lib/investor-interest-level-capability';
import { effectiveGrantForDoc, isDocLocked, isDocNew, groupByFolder, type DataRoomGrantLike } from '@/lib/data-room-investor-view';

interface RawGrant extends GrantStatusInput, DataRoomGrantLike {
  id: string; org_id: string; folder_id?: string; document_id?: string;
}

// Prompt 301 §3 — a flagged document is refused to any viewer other than
// the uploading org itself; every other status (including 'pending' and
// 'not_scanned') still serves normally — hard-blocking anything short of a
// confirmed 'clean' would make every pre-existing document, and every
// upload while VIRUSTOTAL_API_KEY isn't configured, invisible to investors.
async function signedUrlFor(admin: SupabaseClient, d: Record<string, unknown>) {
  if (d.external_url) return d.external_url as string;
  if (!d.storage_path) return null;
  if (d.malware_scan_status === 'flagged') return null;
  const { data } = await admin.storage.from('data-room').createSignedUrl(d.storage_path as string, 300);
  return data?.signedUrl ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();

  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: rawGrants, error } = await admin.from('access_grants').select('*')
    .is('revoked_at', null).or(orParts.join(','));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Prompt 338 — this investor's own "last visited the Data room" marker.
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  const { data: memberRow } = await admin.from('matchdeal_investor_members')
    .select('id, data_room_last_seen_at').eq('user_id', user.id).maybeSingle();
  const lastSeenAt = (memberRow?.data_room_last_seen_at as string | null) ?? null;

  const now = new Date();
  const grants = (rawGrants ?? []) as RawGrant[];
  const byOrg = new Map<string, RawGrant[]>();
  for (const g of grants) byOrg.set(g.org_id, [...(byOrg.get(g.org_id) ?? []), g]);

  const orgIds = [...byOrg.keys()];
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name, logo_url').in('id', orgIds) : { data: [] };
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const orgLogoPathById = new Map((orgs ?? []).map((o) => [o.id as string, o.logo_url as string | null]));

  // Prompt 338 — "nível de ligação" per startup, the exact same disclosure-
  // ladder level computed everywhere else (P136's own currentInterestLevel)
  // — never a second, ad-hoc notion of "how connected are we".
  const levelByOrg = new Map<string, InterestLevel>();
  if (investorCatalogEntityId && orgIds.length > 0 && await interestLevelAvailable()) {
    const { data: decisionRows } = await admin.from('investor_relationship_decisions')
      .select('org_id, decision').eq('investor_catalog_entity_id', investorCatalogEntityId).in('org_id', orgIds);
    const decisionByOrg = new Map((decisionRows ?? []).map((r) => [r.org_id as string, r.decision as 'interested' | 'passed']));
    await Promise.all(orgIds.map(async (orgId) => {
      const levelRows = await getInterestLevelRows(admin, orgId, investorCatalogEntityId);
      levelByOrg.set(orgId, currentInterestLevel(decisionByOrg.get(orgId) ?? null, levelRows));
    }));
  }

  interface DocRow { id: string; name: string; url: string | null; expiresAt: string | null; sharedAt: string; locked: boolean; isNew: boolean; folderName: string }
  const granted: {
    orgId: string; orgName: string; logoUrl: string | null; level: InterestLevel | null; grantedAt: string | null;
    pendingNdaCount: number; folders: { folderName: string; documents: DocRow[] }[];
  }[] = [];
  const expired: { orgId: string; orgName: string; expiredAt: string | null; count: number }[] = [];

  for (const [orgId, orgGrants] of byOrg) {
    const orgName = orgNameById.get(orgId) ?? 'Unknown startup';
    const activeGrants = orgGrants.filter((g) => grantIsActive(g, now));
    const expiredGrants = orgGrants.filter((g) => grantStatus(g, now) === 'expired');

    let logoUrl: string | null = null;
    const logoPath = orgLogoPathById.get(orgId);
    if (logoPath) {
      const { data: signed } = await admin.storage.from('data-room').createSignedUrl(logoPath, 3600);
      logoUrl = signed?.signedUrl ?? null;
    }

    if (activeGrants.length > 0 && await vaultFrozenForOrg(admin, orgId)) {
      // Prompt 278 §4 — the kill switch: the grant is real and stays listed
      // (it's not expired or revoked), but no document/folder crosses this
      // response while the switch is on — same "documents/folders only"
      // scope as every other gated route in this prompt.
      const grantedAt = activeGrants.map((g) => g.granted_at).sort()[0] ?? null;
      granted.push({ orgId, orgName, logoUrl, level: levelByOrg.get(orgId) ?? null, grantedAt, pendingNdaCount: 0, folders: [] });
      continue;
    }
    if (activeGrants.length === 0) {
      if (expiredGrants.length > 0) {
        const expiredAt = expiredGrants.map((g) => g.expires_at).filter((v): v is string => !!v).sort().reverse()[0] ?? null;
        expired.push({ orgId, orgName, expiredAt, count: expiredGrants.length });
      }
      continue;
    }

    // Same resolution as /api/portal/access: fetch every candidate document
    // (granted folders' contents + directly-granted documents), then let
    // resolveDocumentAccess's own visibility rules decide which are
    // reachable at all — a document outside the grant's scope entirely
    // (wrong folder subtree, private visibility with no direct grant)
    // still never appears here, same as before. Only the NDA-locked subset
    // of that visible-scope changes: shown, not hidden.
    // Prompt 204 §A — fecho descendente: um grant de pasta cobre a subarvore.
    const { data: orgFolders } = await admin.from('folders').select('id, parent_id').eq('org_id', orgId);
    const folderTree = (orgFolders ?? []).map((f) => ({ id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined }));
    const folderIds = descendantFolderIds(folderTree, activeGrants.filter((g) => g.folder_id).map((g) => g.folder_id as string));
    const directDocIds = activeGrants.filter((g) => g.document_id).map((g) => g.document_id as string);
    const [{ data: docsInFolders }, { data: directDocs }] = await Promise.all([
      folderIds.length ? admin.from('documents').select('*').in('folder_id', folderIds) : Promise.resolve({ data: [] }),
      directDocIds.length ? admin.from('documents').select('*').in('id', directDocIds) : Promise.resolve({ data: [] }),
    ]);
    const docMap = new Map<string, Record<string, unknown>>();
    for (const d of [...(docsInFolders ?? []), ...(directDocs ?? [])]) docMap.set(d.id as string, d);
    const candidateDocs = [...docMap.values()];

    // Still the gate for "is this document in scope at all" (private
    // visibility with no direct grant, wrong subtree, etc.) — only the
    // NDA-lock decision moves out of this filter and into isDocLocked below.
    const { visibleIds: inScopeIds } = resolveDocumentAccess(
      // nda_required neutralized here on purpose: this call now only decides
      // SCOPE, not the NDA lock — isDocLocked (below) is the single place
      // that decides locked vs open, so the two decisions can never disagree.
      activeGrants.map((g) => ({ ...g, nda_required: false, nda_accepted_at: g.nda_accepted_at ?? undefined })),
      candidateDocs.map((d) => ({ id: d.id as string, folder_id: (d.folder_id as string | undefined) ?? undefined, visibility: d.visibility as string | undefined })),
      folderTree,
    );
    const inScopeDocs = candidateDocs.filter((d) => inScopeIds.includes(d.id as string));

    const allFolderIds = [...new Set(inScopeDocs.map((d) => d.folder_id as string).filter(Boolean))];
    const { data: folderRows } = allFolderIds.length
      ? await admin.from('folders').select('id, name').in('id', allFolderIds) : { data: [] };
    const folderNameById = new Map((folderRows ?? []).map((f) => [f.id as string, f.name as string]));

    let pendingNdaCount = 0;
    const flatDocs: DocRow[] = await Promise.all(inScopeDocs.map(async (d) => {
      const doc = { id: d.id as string, folder_id: (d.folder_id as string | null) ?? null };
      const effectiveGrant = effectiveGrantForDoc(doc, activeGrants);
      const locked = isDocLocked(effectiveGrant);
      if (locked) pendingNdaCount += 1;
      const sharedAt = effectiveGrant?.granted_at ?? (activeGrants[0]?.granted_at as string);
      return {
        id: d.id as string, name: d.name as string,
        url: locked ? null : await signedUrlFor(admin, d),
        expiresAt: (effectiveGrant?.expires_at as string | null | undefined) ?? null,
        sharedAt, locked, isNew: isDocNew(sharedAt, lastSeenAt),
        folderName: folderNameById.get(d.folder_id as string) ?? 'Documents',
      };
    }));

    const folders = [...groupByFolder(flatDocs).entries()].map(([folderName, documents]) => ({ folderName, documents }));
    const grantedAt = activeGrants.map((g) => g.granted_at).sort()[0] ?? null;
    granted.push({ orgId, orgName, logoUrl, level: levelByOrg.get(orgId) ?? null, grantedAt, pendingNdaCount, folders });
  }

  // Item 1 (Lote E) step 5 — this investor's own access_requests rows,
  // pending or recently declined (granted ones become real access_grants
  // rows and already show on the Granted tab above — showing them here too
  // would be the same relationship in two tabs at once). requested_email
  // covers a request filed before this session ever resolved a person_id.
  const reqOrParts = [`person_id.eq.${person?.id ?? '00000000-0000-0000-0000-000000000000'}`, `requested_email.eq.${email}`];
  const { data: accessRequests } = await admin.from('access_requests').select('org_id, status, requested_at, responded_at')
    .or(reqOrParts.join(',')).in('status', ['pending', 'declined']);
  const requestOrgIds = [...new Set((accessRequests ?? []).map((r) => r.org_id as string))];
  const requestOrgNameById = new Map<string, string>(orgNameById);
  const missingOrgIds = requestOrgIds.filter((id) => !requestOrgNameById.has(id));
  if (missingOrgIds.length > 0) {
    const { data: extraOrgs } = await admin.from('orgs').select('id, name').in('id', missingOrgIds);
    for (const o of extraOrgs ?? []) requestOrgNameById.set(o.id as string, o.name as string);
  }
  const requested = (accessRequests ?? []).map((r) => ({
    orgId: r.org_id as string,
    orgName: requestOrgNameById.get(r.org_id as string) ?? 'Unknown startup',
    status: r.status as 'pending' | 'declined',
    requestedAt: r.requested_at as string,
    respondedAt: (r.responded_at as string | null) ?? null,
  }));

  // Prompt 338 — stamp "visited now", after everything above already read
  // the PREVIOUS value to compute isNew. Best-effort: a failure here never
  // breaks the response the investor is actually here for.
  if (memberRow?.id) {
    await admin.from('matchdeal_investor_members').update({ data_room_last_seen_at: now.toISOString() }).eq('id', memberRow.id as string).then(() => {}, () => {});
  }

  return NextResponse.json({ granted, requested, expired });
}
