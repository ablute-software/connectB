// NEXT_STEPS Phase 4 — investor portal data, real per-org grants.
// Service-role only: investors are never org_members, so RLS can't grant
// them table access (same pattern documented in 0001_init.sql). This route
// validates access_grants by email and mints short-lived signed URLs for
// Storage-backed documents; external links pass through as-is.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();

  const orParts = [`grantee_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: grants, error: grantsErr } = await admin.from('access_grants').select('*')
    .is('revoked_at', null).or(orParts.join(','));
  if (grantsErr) return NextResponse.json({ error: grantsErr.message }, { status: 500 });

  const activeGrants = (grants ?? []).filter((g) => !g.expires_at || new Date(g.expires_at) > new Date());
  if (activeGrants.length === 0) {
    return NextResponse.json({ orgName: null, needsNda: false, folders: [], documents: [] });
  }

  // MVP: one investor identity = one org's grants at a time (the first match).
  // A single login surfacing grants from several different startups needs a
  // real investor identity model — that's IRM_SPEC §5 (self-claim), not this pass.
  const orgId = activeGrants[0].org_id;
  const orgGrants = activeGrants.filter((g) => g.org_id === orgId);
  const needsNda = orgGrants.some((g) => g.nda_required && !g.nda_accepted_at);

  const { data: org } = await admin.from('orgs').select('name, sender_email').eq('id', orgId).single();

  const folderIds = orgGrants.filter((g) => g.folder_id).map((g) => g.folder_id as string);
  const documentIds = orgGrants.filter((g) => g.document_id).map((g) => g.document_id as string);

  const [{ data: folders }, { data: docsInFolders }, { data: directDocs }] = await Promise.all([
    folderIds.length ? admin.from('folders').select('id, name').in('id', folderIds) : Promise.resolve({ data: [] }),
    folderIds.length ? admin.from('documents').select('*').in('folder_id', folderIds) : Promise.resolve({ data: [] }),
    documentIds.length ? admin.from('documents').select('*').in('id', documentIds) : Promise.resolve({ data: [] }),
  ]);

  const docMap = new Map<string, Record<string, unknown>>();
  for (const d of [...(docsInFolders ?? []), ...(directDocs ?? [])]) docMap.set(d.id as string, d);

  const documents = await Promise.all([...docMap.values()].map(async (d) => {
    let signedUrl: string | null = (d.external_url as string | null) ?? null;
    if (!signedUrl && d.storage_path) {
      const { data: signed } = await admin.storage.from('data-room').createSignedUrl(d.storage_path as string, 300);
      signedUrl = signed?.signedUrl ?? null;
    }
    return {
      id: d.id, name: d.name, version: d.version, watermark: d.watermark,
      downloadable: d.downloadable, folder_id: d.folder_id, url: signedUrl,
    };
  }));

  return NextResponse.json({
    orgName: org?.name ?? null, senderEmail: org?.sender_email ?? null,
    needsNda, folders: folders ?? [], documents,
  });
}
