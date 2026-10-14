// Prompt 907 (I2) — take a file off a question (while the application is a draft). An uploaded object is removed from storage; a Vault file only
// loses the pin (the document stays in the Vault, untouched). The question's answer is cleared in the draft.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { loadApplication, removeFileRow, saveDraft } from '@/lib/calls/applicant/store';

export const dynamic = 'force-dynamic';

export const DELETE = withActingOrg(async function DELETE(req: Request, { params }: { params: { id: string; fileId: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  if (a.app.status !== 'draft') return NextResponse.json({ ok: false, code: 'not_draft', error: 'This application was submitted: it can no longer be changed.' }, { status: 409 });
  const { data: accepting } = await a.admin.rpc('call_accepting', { p_call: a.call.id });
  if (accepting !== true) return NextResponse.json({ ok: false, code: 'closed', error: 'This call is no longer accepting applications.' }, { status: 409 });

  const row = await removeFileRow(a.admin, a.app.id, params.fileId);
  if (!row) return NextResponse.json({ ok: false, error: 'That file does not exist.' }, { status: 404 });
  if (row.source === 'upload') await a.admin.storage.from('data-room').remove([row.storagePath]);

  // Clear the answer that pointed at it (one retry if another window saved in between).
  for (let i = 0; i < 2; i++) {
    const fresh = await loadApplication(a.admin, a.app.id);
    if (!fresh || fresh.status !== 'draft') break;
    const cur = fresh.answers[row.fieldId];
    if (!(cur && typeof cur === 'object' && !Array.isArray(cur) && cur.fileId === row.id)) break;
    const { [row.fieldId]: _gone, ...rest } = fresh.answers;
    const saved = await saveDraft(a.admin, fresh, rest, fresh.lastPage, fresh.revision);
    if (saved.ok) return NextResponse.json({ ok: true, revision: saved.revision });
  }
  return NextResponse.json({ ok: true });
});
