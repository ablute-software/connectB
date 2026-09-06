// Prompt 871 §D — the quarantine's missing exit door. catalog_person_
// apply_field (migration 0322) had zero TypeScript call-sites: the only
// promotion path was the 3-real-org auto-consensus, which is
// mathematically unreachable today (only 1 org has any catalog_person_id-
// linked people) — so everything a founder contributes sat in 'submitted'
// forever, and 'verified_by_admin' was a label nothing could ever produce.
// This is that missing action: approve writes the value into the catalog
// (via the same function the consensus trigger itself calls, so both
// paths go through exactly one write) and marks every 'submitted'
// contribution sharing that normalized value verified; reject marks them
// rejected with a reviewer note. Both are scoped to one (field, value)
// claim, not the whole field — a person can have two orgs disagreeing on
// a field, and approving one claim must not touch the other.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

function normalize(value: unknown): string {
  return Array.isArray(value)
    ? [...value].map((v) => String(v).toLowerCase().trim()).sort().join('|')
    : String(value).toLowerCase().trim();
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  const { id } = params;

  const body = await req.json().catch(() => ({})) as { field?: string; value?: unknown; decision?: string; reviewerNotes?: string };
  const { field, value, decision, reviewerNotes } = body;
  if (!field || value === undefined || (decision !== 'approve' && decision !== 'reject')) {
    return NextResponse.json({ ok: false, error: 'field, value and a decision of approve/reject are required.' }, { status: 400 });
  }

  const { data: matching, error: fetchErr } = await admin.from('contributions').select('id, value')
    .eq('subject_type', 'catalog_person').eq('subject_id', id).eq('field', field).eq('status', 'submitted');
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });

  const targetKey = normalize(value);
  const ids = (matching ?? []).filter((c) => normalize(c.value) === targetKey).map((c) => c.id as string);
  if (ids.length === 0) return NextResponse.json({ ok: false, error: 'No pending contribution matches that field/value — it may have already been reviewed.' }, { status: 404 });

  if (decision === 'approve') {
    const { error: applyErr } = await admin.rpc('catalog_person_apply_field', {
      p_person_id: id, p_field: field, p_value: value, p_level: 'verified_by_admin',
    });
    if (applyErr) return NextResponse.json({ ok: false, error: applyErr.message }, { status: 500 });

    const { error: updErr } = await admin.from('contributions').update({
      status: 'verified', reviewed_at: new Date().toISOString(),
      reviewer_notes: reviewerNotes?.trim() || 'Approved by admin.',
    }).in('id', ids);
    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  } else {
    const { error: updErr } = await admin.from('contributions').update({
      status: 'rejected', reviewed_at: new Date().toISOString(),
      reviewer_notes: reviewerNotes?.trim() || null,
    }).in('id', ids);
    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  await logAdminAction(admin, {
    adminUserId: userId,
    action: decision === 'approve' ? 'catalog_person_quarantine_approve' : 'catalog_person_quarantine_reject',
    subjectType: 'catalog_person', subjectId: id,
    detail: { field, value, contributionIds: ids, reviewerNotes: reviewerNotes?.trim() || null },
  });

  return NextResponse.json({ ok: true, affected: ids.length });
}
