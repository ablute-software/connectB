// Prompt 907 (I2) — a newer version of a Vault document exists: the applicant confirmed they want it in the draft. Only before submission;
// the pin moves to the latest version, and from then on that is what a submission would copy.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { loadFiles, loadVaultPdf, objectSize, repinVaultFile } from '@/lib/calls/applicant/store';
import { DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING } from '@/lib/calls/types';
import { logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

export const POST = withActingOrg(async function POST(req: Request, { params }: { params: { id: string; fileId: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  if (a.app.status !== 'draft') return NextResponse.json({ ok: false, code: 'not_draft', error: 'This application was submitted: it can no longer be changed.' }, { status: 409 });
  const { data: accepting } = await a.admin.rpc('call_accepting', { p_call: a.call.id });
  if (accepting !== true) return NextResponse.json({ ok: false, code: 'closed', error: 'This call is no longer accepting applications.' }, { status: 409 });

  const file = (await loadFiles(a.admin, a.app.id)).find((f) => f.id === params.fileId && f.source === 'vault' && f.documentId);
  if (!file) return NextResponse.json({ ok: false, error: 'That file does not exist.' }, { status: 404 });
  const latest = await loadVaultPdf(a.admin, a.orgId, file.documentId as string);
  if (!latest) return NextResponse.json({ ok: false, error: 'That document is no longer available in your Vault as a PDF.' }, { status: 404 });
  const size = latest.sizeBytes ?? (await objectSize(a.admin, latest.storagePath));
  const field = a.fields.find((f) => f.id === file.fieldId);
  const maxMb = Math.min(field?.validations.maxFileMb ?? DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING);
  if (size === null || size > maxMb * 1024 * 1024) return NextResponse.json({ ok: false, error: size === null ? 'We could not read the size of the new version.' : `The new version is too large (maximum ${maxMb} MB).` }, { status: 400 });
  if (!(await repinVaultFile(a.admin, file.id, latest, size))) return NextResponse.json({ ok: false, error: 'We could not update the document.' }, { status: 500 });
  await logCallEvent(a.admin, a.call.id, 'vault_document_updated', a.userId, { applicationId: a.app.id, documentId: file.documentId, from: file.versionNumber, to: latest.version });
  return NextResponse.json({ ok: true, file: { id: file.id, fieldId: file.fieldId, source: 'vault', fileName: latest.name, size, versionNumber: latest.version, documentId: file.documentId } });
});
