// Investor Workspace — "Access granted" page (Prompt 121 §2.5). Distinct
// from /api/portal/access (which resolves ONE org's data room for the
// startup-card view, per Prompt 120 Block A's routing): this route surfaces
// EVERY startup this investor has ever held a grant for, split into Granted
// (currently active, documents grouped by folder) and Expired (expires_at
// has passed, not revoked — a founder-revoked grant is a different decision
// and isn't shown on either tab, matching the prompt's own three named
// tabs). A pending_confirmation grant (the founder-invite "Is this you?"
// flow, migration 0045) shows on neither tab — same non-leak rule
// /api/portal/access already applies: no document/metadata until confirmed.
//
// "Access requested" (item 1 (Lote E) step 5, 07/08/2026) — access_requests
// is applied (migration 0114) and now actually read here: pending rows show
// as "waiting on the founder," and a request the founder just declined
// shows for one more load so the investor isn't left wondering — the client
// still gates the tab's content on /api/me's accessRequests capability for
// pre-migration environments.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { grantStatus, grantIsActive, type GrantStatusInput } from '@/lib/access-grants';
import { descendantFolderIds, resolveDocumentAccess } from '@/lib/data-room';
import { vaultFrozenForOrg } from '@/lib/data-room-server';

interface RawGrant extends GrantStatusInput {
  id: string; org_id: string; folder_id?: string; document_id?: string;
  granted_at: string; nda_required: boolean; nda_accepted_at?: string;
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

  const now = new Date();
  const grants = (rawGrants ?? []) as RawGrant[];
  const byOrg = new Map<string, RawGrant[]>();
  for (const g of grants) byOrg.set(g.org_id, [...(byOrg.get(g.org_id) ?? []), g]);

  const orgIds = [...byOrg.keys()];
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] };
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const granted: { orgId: string; orgName: string; grantedAt: string | null; folders: { folderName: string; documents: { id: string; name: string; url: string | null; expiresAt: string | null }[] }[] }[] = [];
  const expired: { orgId: string; orgName: string; expiredAt: string | null; count: number }[] = [];

  for (const [orgId, orgGrants] of byOrg) {
    const orgName = orgNameById.get(orgId) ?? 'Unknown startup';
    const activeGrants = orgGrants.filter((g) => grantIsActive(g, now));
    const expiredGrants = orgGrants.filter((g) => grantStatus(g, now) === 'expired');

    if (activeGrants.length > 0 && await vaultFrozenForOrg(admin, orgId)) {
      // Prompt 278 §4 — the kill switch: the grant is real and stays listed
      // (it's not expired or revoked), but no document/folder crosses this
      // response while the switch is on — same "documents/folders only"
      // scope as every other gated route in this prompt.
      const grantedAt = activeGrants.map((g) => g.granted_at).sort()[0] ?? null;
      granted.push({ orgId, orgName, grantedAt, folders: [] });
    } else if (activeGrants.length > 0) {
      // Same resolution as /api/portal/access: fetch every candidate
      // document (granted folders' contents + directly-granted documents),
      // then let resolveDocumentAccess apply the "document-level grant
      // overrides its folder's grant" + NDA-gating rules.
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

      const { visibleIds } = resolveDocumentAccess(
        activeGrants,
        candidateDocs.map((d) => ({
          id: d.id as string, folder_id: (d.folder_id as string | undefined) ?? undefined,
          visibility: d.visibility as string | undefined,
        })),
        folderTree,
      );
      const visibleDocs = candidateDocs.filter((d) => visibleIds.includes(d.id as string));

      const allFolderIds = [...new Set(visibleDocs.map((d) => d.folder_id as string).filter(Boolean))];
      const { data: folderRows } = allFolderIds.length
        ? await admin.from('folders').select('id, name').in('id', allFolderIds) : { data: [] };
      const folderNameById = new Map((folderRows ?? []).map((f) => [f.id as string, f.name as string]));

      // expires_at applies per-grant; a document's own effective expiry is
      // whichever grant (document-level, else its folder's) actually
      // covers it — same override precedence resolveDocumentAccess used.
      const byDocGrant = new Map(activeGrants.filter((g) => g.document_id).map((g) => [g.document_id as string, g]));
      const byFolderGrant = new Map(activeGrants.filter((g) => g.folder_id).map((g) => [g.folder_id as string, g]));

      const byFolder = new Map<string, typeof visibleDocs>();
      for (const d of visibleDocs) {
        const key = (d.folder_id as string) ?? 'ungrouped';
        byFolder.set(key, [...(byFolder.get(key) ?? []), d]);
      }
      const folders = await Promise.all([...byFolder.entries()].map(async ([folderId, docs]) => ({
        folderName: folderNameById.get(folderId) ?? 'Documents',
        documents: await Promise.all(docs.map(async (d) => {
          const effectiveGrant = byDocGrant.get(d.id as string) ?? byFolderGrant.get(d.folder_id as string);
          return {
            id: d.id as string, name: d.name as string,
            url: await signedUrlFor(admin, d),
            expiresAt: (effectiveGrant?.expires_at as string | null | undefined) ?? null,
          };
        })),
      })));

      const grantedAt = activeGrants.map((g) => g.granted_at).sort()[0] ?? null;
      granted.push({ orgId, orgName, grantedAt, folders });
    } else if (expiredGrants.length > 0) {
      const expiredAt = expiredGrants.map((g) => g.expires_at).filter((v): v is string => !!v).sort().reverse()[0] ?? null;
      expired.push({ orgId, orgName, expiredAt, count: expiredGrants.length });
    }
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

  return NextResponse.json({ granted, requested, expired });
}
