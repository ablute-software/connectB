// Prompt 909 (I4) — a source document of a call (a regulation, a previous form, a grid that was imported) can be
// deleted by whoever can configure the call. The file and its row go; what was already applied from it stays.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { deleteSourceDocument, setSourcePublic } from '@/lib/calls/ai-import/store';
import { logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

// Prompt 907 (I1): show (or stop showing) a regulation PDF on the call's link. Allowed in any state: it is not the applicant-facing form.
export async function PATCH(req: Request, { params }: { params: { id: string; docId: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { publicToApplicants?: unknown };
  if (typeof body.publicToApplicants !== 'boolean') return NextResponse.json({ ok: false, error: 'publicToApplicants must be true or false.' }, { status: 400 });
  const r = await setSourcePublic(auth.admin, auth.call.id, params.docId, body.publicToApplicants);
  if (!r.ok) {
    return r.reason === 'not_found'
      ? NextResponse.json({ ok: false, error: 'That document does not exist.' }, { status: 404 })
      : NextResponse.json({ ok: false, error: 'Only a regulation that is a PDF can be shown to applicants.' }, { status: 400 });
  }
  await logCallEvent(auth.admin, auth.call.id, body.publicToApplicants ? 'regulation_shown_to_applicants' : 'regulation_hidden_from_applicants', auth.userId, { docId: params.docId });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; docId: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const doc = await deleteSourceDocument(auth.admin, auth.call.id, params.docId);
  if (!doc) return NextResponse.json({ ok: false, error: 'That document does not exist.' }, { status: 404 });
  await logCallEvent(auth.admin, auth.call.id, 'source_document_deleted', auth.userId, { fileName: doc.fileName, kind: doc.kind });
  return NextResponse.json({ ok: true });
}
