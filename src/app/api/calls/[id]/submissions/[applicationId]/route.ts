// Prompt 907 (I4) — open ONE submitted application, as it was submitted: the answers, the documents (frozen copies) and the form as it was. The
// immutable version only — never the working copy, and a draft is a 404 (the entity does not know it exists).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { loadEligibilityRows } from '@/lib/calls/eligibility-lists';
import { loadSubmission } from '@/lib/calls/applicant/store';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await authCall(params.id, { need: 'view_applications' });
  if (auth.error) return auth.error;
  const { data: app } = await auth.admin.from('call_applications').select('id, startup_org_id, reference, status, current_submission_id, submitted_at')
    .eq('id', params.applicationId).eq('call_id', auth.call.id).eq('status', 'submitted').maybeSingle();
  const a = app as Row | null;
  if (!a || !a.current_submission_id) return NextResponse.json({ ok: false }, { status: 404 });
  const sub = await loadSubmission(auth.admin, a.current_submission_id as string);
  if (!sub) return NextResponse.json({ ok: false }, { status: 404 });
  const { data: org } = await auth.admin.from('orgs').select('name').eq('id', a.startup_org_id as string).maybeSingle();
  // Prompt 918 (I3): the eligibility of this application rule by rule, and the others of this call that share something with it. Only submitted applications of THIS call are compared.
  const { data: all } = await auth.admin.from('call_applications').select('id, startup_org_id, reference, submitted_at, current_submission_id').eq('call_id', auth.call.id).eq('status', 'submitted');
  const elig = (await loadEligibilityRows(auth.admin, auth.call, (all ?? []) as Row[])).find((e) => e.applicationId === params.applicationId);
  const snapshot = (await auth.admin.from('call_application_submissions').select('form_snapshot').eq('id', sub.id).maybeSingle()).data as { form_snapshot?: { fields?: unknown[] } } | null;
  return NextResponse.json({
    ok: true,
    eligibility: elig?.info ?? null, duplicates: elig?.duplicates ?? [], canCorrect: auth.perms.correct_eligibility, canFlag: true,
    reference: (a.reference as string | null) ?? null, startup: (org as Row | null)?.name ?? 'A startup', submittedAt: sub.submittedAt, version: sub.version,
    fields: snapshot?.form_snapshot?.fields ?? [], answers: sub.answers,
    documents: sub.documents.map((d) => ({ fileId: d.fileId, fieldId: d.fieldId, fileName: d.fileName, size: d.size, source: d.source, versionNumber: d.versionNumber, url: `/api/calls/${auth.call.id}/submissions/${a.id}/documents/${d.fileId}` })),
  });
}
