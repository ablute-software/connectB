// Prompt 922 (I3), Prompt 930 (B) — a document of the application, read INSIDE the platform: the frozen copy made at submission, streamed through this route (the bytes pass here; no Storage address ever reaches the
// browser, so there is no link to copy or forward). The evaluator needs the application assigned to them; an administrator any. When the evaluation is blind the file keeps its content but its name is masked. Every
// opening is recorded (who, which document, when).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { logDocumentOpened, streamFrozenDocument } from '@/lib/calls/document-stream';
import { documentFor, gateFor } from '@/lib/calls/eval-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string; applicationId: string; fileId: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  const gate = await gateFor(auth, params.applicationId);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const doc = await documentFor(auth, gate, params.fileId);
  if (!doc) return NextResponse.json({ ok: false }, { status: 404 });
  const out = await streamFrozenDocument(auth.admin, doc.frozenPath, doc.fileName);
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: out.status });
  await logDocumentOpened(auth.admin, auth.call.id, params.applicationId, auth.userId, params.fileId, 'evaluation');
  return out.response;
}
