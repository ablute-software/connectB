// Prompt 585 §G.1 — the admin approve/reject action for a founder-
// proposed evidence row, mirroring the exact shape of
// /api/backoffice/catalog/people/[id]/quarantine/route.ts (Prompt 871 §D)
// but operating directly on catalog_evidence rather than the generic
// contributions table — see migration 0347's own header comment for why
// that table isn't reused here (catalog_person_apply_field writes a
// single catalog_people/catalog_people_research field; it has no way to
// "apply" an evidence row).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request, { params }: { params: { id: string; evidenceId: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  const { id, evidenceId } = params;

  const body = await req.json().catch(() => ({})) as { decision?: string; reviewerNotes?: string };
  const { decision, reviewerNotes } = body;
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ ok: false, error: 'A decision of approve/reject is required.' }, { status: 400 });
  }

  const { data: evidence, error: fetchErr } = await admin
    .from('catalog_evidence').select('id, person_id, status')
    .eq('id', evidenceId).eq('person_id', id).maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!evidence) return NextResponse.json({ ok: false, error: 'Evidence not found for this person.' }, { status: 404 });
  if (evidence.status !== 'quarantined') {
    return NextResponse.json({ ok: false, error: `Already reviewed (status: ${evidence.status}).` }, { status: 409 });
  }

  const toStatus = decision === 'approve' ? 'verified' : 'rejected';
  const patch: Record<string, unknown> = { status: toStatus };
  if (decision === 'approve') { patch.verified_by = userId; patch.verified_at = new Date().toISOString(); }

  const { error: updErr } = await admin.from('catalog_evidence').update(patch).eq('id', evidenceId);
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId,
    action: decision === 'approve' ? 'catalog_evidence_quarantine_approve' : 'catalog_evidence_quarantine_reject',
    subjectType: 'catalog_evidence', subjectId: evidenceId,
    detail: { personId: id, from: 'quarantined', to: toStatus, reviewerNotes: reviewerNotes?.trim() || null },
  });

  return NextResponse.json({ ok: true });
}
