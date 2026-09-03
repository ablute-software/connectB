// Prompt 347 §B — "Track & Evaluate" per-document scoring. Same pattern as
// /api/portal/scorecard/scores: investor-private, per seat
// (matchdeal_investor_members.id), never read by any founder-facing route.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { projectDocScoresWithHistory, type DocScoreRow } from '@/lib/investor-doc-scores';
import { assertNotViewer } from '@/lib/developer-viewer';
import { getCurrentDocumentVersionId } from '@/lib/document-versions';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ scores: {} });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ scores: {} });

  const { data: rows } = await admin.from('investor_doc_scores').select('document_id, document_version_id, score, note, updated_at')
    .eq('investor_member_id', member.id).eq('startup_org_id', orgId);
  const docIds = [...new Set((rows ?? []).map((r) => r.document_id as string))];
  // Prompt 355 §A — current-version-per-document, batched in one query
  // rather than per-row: every score row this investor ever left for THIS
  // org's documents, at most a few dozen distinct documents.
  const { data: versionRows } = docIds.length
    ? await admin.from('document_versions').select('document_id, id, version').in('document_id', docIds).order('version', { ascending: false })
    : { data: [] };
  const currentVersionByDocument: Record<string, string | null> = {};
  for (const docId of docIds) currentVersionByDocument[docId] = null;
  for (const v of versionRows ?? []) {
    if (currentVersionByDocument[v.document_id as string] === null) currentVersionByDocument[v.document_id as string] = v.id as string;
  }

  return NextResponse.json({ scores: projectDocScoresWithHistory((rows ?? []) as DocScoreRow[], currentVersionByDocument) });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string; documentId?: string; score?: number; note?: string };
  if (!body.orgId || !body.documentId) return NextResponse.json({ ok: false, error: 'orgId and documentId are required.' }, { status: 400 });
  if (typeof body.score !== 'number' || body.score < 0 || body.score > 10) {
    return NextResponse.json({ ok: false, error: 'score must be between 0 and 10.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  // Confirms the document actually belongs to the org being scored, before
  // writing anything against it — the same "resolve, then check ownership
  // before writing" discipline the scorecard scores route uses.
  const { data: doc } = await admin.from('documents').select('id').eq('id', body.documentId).eq('org_id', body.orgId).maybeSingle();
  if (!doc) return NextResponse.json({ ok: false, error: 'Document not found.' }, { status: 404 });

  // Prompt 355 §A — every write targets the document's CURRENT version
  // (never an arbitrary/stale one the client might pass), so "rectify the
  // current rating" and "the version changed underneath you" can never be
  // confused. Two separate partial unique indexes back this table now
  // (versioned vs. no-version-at-all for an external-link document), which
  // Postgres's ON CONFLICT can't reliably infer a single target for — so
  // this is an explicit select-then-update-or-insert instead of .upsert().
  const versionId = await getCurrentDocumentVersionId(admin, body.documentId);
  let existingQuery = admin.from('investor_doc_scores').select('id')
    .eq('investor_member_id', member.id).eq('document_id', body.documentId);
  existingQuery = versionId ? existingQuery.eq('document_version_id', versionId) : existingQuery.is('document_version_id', null);
  const { data: existing } = await existingQuery.maybeSingle();

  const patch = { score: body.score, note: body.note?.trim() || null, updated_at: new Date().toISOString() };
  const { error } = existing
    ? await admin.from('investor_doc_scores').update(patch).eq('id', existing.id)
    : await admin.from('investor_doc_scores').insert({
        investor_member_id: member.id, startup_org_id: body.orgId, document_id: body.documentId,
        document_version_id: versionId, ...patch,
      });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
