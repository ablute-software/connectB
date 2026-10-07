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
import { canViewStartup } from '@/lib/can-view-startup';
import { documentNdaByDefaultAvailable } from '@/lib/documents-nda-default-capability';
import { closedOrgGuard } from '@/lib/org-closed';
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

  // Prompt 742 §B.1 — this route used to go from "signed in" straight to
  // querying `orgId`'s documents: any account could read any org's document
  // NAMES by passing its id. A caller with no relationship to the startup gets
  // the same flat 404 the dossier route gives (404, not 403: never confirm the
  // org exists), and this runs BEFORE the closed-org check below for the same
  // reason that route checks relationship before closed-state — answering
  // "closed" first would turn the 410 into an oracle for "this org id exists".
  if (!(await canViewStartup(admin, user.id, email, person?.id ?? null, orgId))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;

  // kind added (deal-terms review fix A, 2026-09-30) — this route's whole
  // job is announcing document NAMES to an investor with zero grants (this
  // file's own header: "with zero grants EVERY on_grant/due_diligence
  // document is locked to them"), which is exactly the leak a locked deal
  // memo (visibility 'private', but defense-in-depth doesn't rely on that
  // alone) must never reach — see the explicit kind check on `requestable`
  // below, on top of the structural exclusion resolveDocumentAccess applies.
  // Prompt 742 §A.3 — nda_by_default, capability-gated: an environment that has
  // not applied the migration yet would hard-error on an unknown column.
  // Explicit `: string` — a template literal is otherwise a literal type that
  // postgrest-js's type-level select parser chokes on.
  const ndaByDefaultOn = await documentNdaByDefaultAvailable();
  const docSelect: string = `id, name, folder_id, visibility, kind${ndaByDefaultOn ? ', nda_by_default' : ''}`;
  const [{ data: rawDocs }, { data: folders }] = await Promise.all([
    admin.from('documents').select(docSelect).eq('org_id', orgId),
    admin.from('folders').select('id, parent_id').eq('org_id', orgId),
  ]);
  // `as unknown as` — docSelect is a runtime string, so postgrest-js cannot
  // infer a row shape for it.
  const docs = (rawDocs ?? []) as unknown as {
    id: string; name: string; folder_id: string | null; visibility: string | null; kind: string | null; nda_by_default?: boolean;
  }[];

  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: grants } = await admin.from('access_grants').select('folder_id, document_id, nda_required, nda_accepted_at')
    .eq('org_id', orgId).is('revoked_at', null).or(orParts.join(','));

  const docMetas: DocMeta[] = docs
    .map((d) => ({ id: d.id, folder_id: d.folder_id ?? undefined, visibility: d.visibility ?? undefined, kind: d.kind, nda_by_default: d.nda_by_default }));
  const treeFolders: TreeFolder[] = ((folders ?? []) as { id: string; parent_id: string | null }[])
    .map((f) => ({ id: f.id, parent_id: f.parent_id ?? undefined }));
  const { visibleIds } = resolveDocumentAccess(
    ((grants ?? []) as { folder_id: string | null; document_id: string | null; nda_required: boolean; nda_accepted_at: string | null }[])
      .map((g) => ({ folder_id: g.folder_id ?? undefined, document_id: g.document_id ?? undefined, nda_required: g.nda_required, nda_accepted_at: g.nda_accepted_at ?? undefined })),
    docMetas, treeFolders,
  );
  const visibleSet = new Set(visibleIds);

  const requestable = docs
    // Explicit kind check, not just the visibility filter that already
    // excludes 'private' — this list must stay correct even if a deal
    // memo's visibility were ever wrong (a stale row, a manual DB edit).
    .filter((d) => (d.visibility === 'on_grant' || d.visibility === 'due_diligence') && d.kind !== 'deal_memo' && !visibleSet.has(d.id))
    .map((d) => ({ id: d.id, name: d.name, visibility: d.visibility }));

  return NextResponse.json({ documents: requestable });
}
