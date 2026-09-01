// Prompt 372 Block B — what an investor can pick FROM when asking for
// documents. Same list either way, deliberately: "with access" sees every
// document not yet visible to them (locked on_grant/due_diligence docs);
// "without access at all" sees exactly the same list, because with zero
// grants EVERY on_grant/due_diligence document is locked to them — no
// separate code path needed. Only name + visibility level are ever
// returned — never content, size, or view counts (Block B §2's explicit
// "nunca conteúdo, tamanho ou visualizações").
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveDocumentAccess, type DocMeta, type TreeFolder } from '@/lib/data-room';

async function resolvePerson(admin: SupabaseClient, email: string) {
  const { data } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  return data as { id: string } | null;
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ documents: [] }, { status: 200 });

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const person = await resolvePerson(admin, email);

  const [{ data: docs }, { data: folders }] = await Promise.all([
    admin.from('documents').select('id, name, folder_id, visibility').eq('org_id', orgId),
    // Prompt 519 §1 — `name` added. The folder rows were already read here,
    // but only to compute access (resolveDocumentAccess needs the parent
    // chain); the response then threw the folder away entirely, so the
    // picker received a flat list and could not have grouped even if it
    // wanted to. The names are what let it.
    admin.from('folders').select('id, parent_id, name').eq('org_id', orgId),
  ]);

  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: grants } = await admin.from('access_grants').select('folder_id, document_id, nda_required, nda_accepted_at')
    .eq('org_id', orgId).is('revoked_at', null).or(orParts.join(','));

  const docMetas: DocMeta[] = ((docs ?? []) as { id: string; folder_id: string | null; visibility: string | null }[])
    .map((d) => ({ id: d.id, folder_id: d.folder_id ?? undefined, visibility: d.visibility ?? undefined }));
  const treeFolders: TreeFolder[] = ((folders ?? []) as { id: string; parent_id: string | null }[])
    .map((f) => ({ id: f.id, parent_id: f.parent_id ?? undefined }));
  const { visibleIds } = resolveDocumentAccess(
    ((grants ?? []) as { folder_id: string | null; document_id: string | null; nda_required: boolean; nda_accepted_at: string | null }[])
      .map((g) => ({ folder_id: g.folder_id ?? undefined, document_id: g.document_id ?? undefined, nda_required: g.nda_required, nda_accepted_at: g.nda_accepted_at ?? undefined })),
    docMetas, treeFolders,
  );
  const visibleSet = new Set(visibleIds);

  const requestable = ((docs ?? []) as { id: string; name: string; folder_id: string | null; visibility: string | null }[])
    .filter((d) => (d.visibility === 'on_grant' || d.visibility === 'due_diligence') && !visibleSet.has(d.id))
    .map((d) => ({ id: d.id, name: d.name, visibility: d.visibility, folderId: d.folder_id ?? null }));

  // Only folders that actually contain something requestable are returned.
  // The investor must never learn the shape of a data room they cannot ask
  // for — an empty folder's NAME is itself information about the startup
  // ("Litigation", "Down round"), which is exactly the kind of leak the
  // visibility rules exist to prevent.
  const requestableByFolder = new Map<string, number>();
  for (const d of requestable) {
    if (!d.folderId) continue;
    requestableByFolder.set(d.folderId, (requestableByFolder.get(d.folderId) ?? 0) + 1);
  }
  const folderList = ((folders ?? []) as { id: string; parent_id: string | null; name: string }[])
    .filter((f) => requestableByFolder.has(f.id))
    .map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id ?? null, requestableCount: requestableByFolder.get(f.id) ?? 0 }));

  return NextResponse.json({ documents: requestable, folders: folderList });
}
