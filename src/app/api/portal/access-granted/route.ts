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
// "Access requested" has no real data here — access_requests doesn't exist
// until migration 0114 lands (PROPOSED, NOT APPLIED); the client reads
// /api/me's accessRequests capability to decide whether to show real
// content or a "coming soon" placeholder for that tab.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { grantStatus, grantIsActive, type GrantStatusInput } from '@/lib/access-grants';
import { resolveDocumentAccess } from '@/lib/data-room';

interface RawGrant extends GrantStatusInput {
  id: string; org_id: string; folder_id?: string; document_id?: string;
  granted_at: string; nda_required: boolean; nda_accepted_at?: string;
}

async function signedUrlFor(admin: SupabaseClient, d: Record<string, unknown>) {
  if (d.external_url) return d.external_url as string;
  if (!d.storage_path) return null;
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

    if (activeGrants.length > 0) {
      // Same resolution as /api/portal/access: fetch every candidate
      // document (granted folders' contents + directly-granted documents),
      // then let resolveDocumentAccess apply the "document-level grant
      // overrides its folder's grant" + NDA-gating rules.
      const folderIds = activeGrants.filter((g) => g.folder_id).map((g) => g.folder_id as string);
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
        candidateDocs.map((d) => ({ id: d.id as string, folder_id: (d.folder_id as string | undefined) ?? undefined })),
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

  return NextResponse.json({ granted, requested: [], expired });
}
