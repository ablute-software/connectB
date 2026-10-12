// Prompt 909 (I4) — a source document of a call (a regulation, a previous form, a grid that was imported) can be
// deleted by whoever can configure the call. The file and its row go; what was already applied from it stays.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { deleteSourceDocument } from '@/lib/calls/ai-import/store';
import { logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string; docId: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const doc = await deleteSourceDocument(auth.admin, auth.call.id, params.docId);
  if (!doc) return NextResponse.json({ ok: false, error: 'That document does not exist.' }, { status: 404 });
  await logCallEvent(auth.admin, auth.call.id, 'source_document_deleted', auth.userId, { fileName: doc.fileName, kind: doc.kind });
  return NextResponse.json({ ok: true });
}
