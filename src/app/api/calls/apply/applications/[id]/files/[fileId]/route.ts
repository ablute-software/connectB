// Prompt 907 (I2) — take a file off a question (while the application is a draft). An uploaded object is removed from storage; a Vault file only
// loses the pin (the document stays in the Vault, untouched). The file leaves the draft's answers wherever it was (Prompt 917: a File question, one of
// several files, or inside an entry of a group).
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { loadApplication, removeFileRow, saveDraft } from '@/lib/calls/applicant/store';
import { removeFileFromAnswers } from '@/lib/calls/field-config';

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
    // The file may be the answer of a File question, one of several, or sit inside an entry of a group: take it out wherever it is.
    const { answers: rest, changed } = removeFileFromAnswers(a.fields, fresh.answers, row.id);
    if (!changed) break;
    const saved = await saveDraft(a.admin, fresh, rest, fresh.lastPage, fresh.revision);
    if (saved.ok) return NextResponse.json({ ok: true, revision: saved.revision });
  }
  return NextResponse.json({ ok: true });
});
