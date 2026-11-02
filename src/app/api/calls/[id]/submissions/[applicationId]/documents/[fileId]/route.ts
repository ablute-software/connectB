// Prompt 907 (I4), Prompt 930 (B) — one document of a SUBMITTED application, read INSIDE the platform: the copy frozen at submission (never the applicant's folder or the Vault), streamed through this route. No
// Storage address ever reaches the browser (it used to be a redirect to a signed address): the bytes pass here, a PDF or an image is sent inline for the in-platform viewer, anything else as a download. Only whoever may
// view the applications of the call, only a document of the submitted version, and every opening is recorded (who, which document, when).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { loadSubmission } from '@/lib/calls/applicant/store';
import { logDocumentOpened, streamFrozenDocument } from '@/lib/calls/document-stream';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string; applicationId: string; fileId: string } }) {
  const auth = await authCall(params.id, { need: 'view_applications' });
  if (auth.error) return auth.error;
  const { data: app } = await auth.admin.from('call_applications').select('id, status, current_submission_id').eq('id', params.applicationId).eq('call_id', auth.call.id).eq('status', 'submitted').maybeSingle();
  const submissionId = (app as { current_submission_id?: string } | null)?.current_submission_id;
  const sub = submissionId ? await loadSubmission(auth.admin, submissionId) : null;
  const doc = sub?.documents.find((d) => d.fileId === params.fileId);
  if (!doc || typeof doc.frozenPath !== 'string' || !doc.frozenPath) return NextResponse.json({ ok: false }, { status: 404 });
  const out = await streamFrozenDocument(auth.admin, doc.frozenPath, doc.fileName);
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: out.status });
  await logDocumentOpened(auth.admin, auth.call.id, params.applicationId, auth.userId, params.fileId, 'applications');
  return out.response;
}
