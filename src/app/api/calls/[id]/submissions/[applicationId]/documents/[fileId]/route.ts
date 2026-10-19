// Prompt 907 (I4) — download one document of a SUBMITTED application: the copy frozen at submission (never the applicant's folder or the Vault),
// through a short-lived signed URL. Only documents that belong to the submitted version.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { loadSubmission } from '@/lib/calls/applicant/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string; applicationId: string; fileId: string } }) {
  const auth = await authCall(params.id, { need: 'view_applications' });
  if (auth.error) return auth.error;
  const { data: app } = await auth.admin.from('call_applications').select('id, status, current_submission_id').eq('id', params.applicationId).eq('call_id', auth.call.id).eq('status', 'submitted').maybeSingle();
  const submissionId = (app as { current_submission_id?: string } | null)?.current_submission_id;
  const sub = submissionId ? await loadSubmission(auth.admin, submissionId) : null;
  const doc = sub?.documents.find((d) => d.fileId === params.fileId);
  if (!doc) return NextResponse.json({ ok: false }, { status: 404 });
  const { data: signed } = await auth.admin.storage.from('data-room').createSignedUrl(doc.frozenPath, 120, { download: doc.fileName });
  if (!signed?.signedUrl) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, 302);
}
