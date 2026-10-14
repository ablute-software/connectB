// Prompt 907 (I2) — attach a file to a "document" question (spec §6.6), in one of two ways:
//   kind "upload": the browser has already put a PDF in the startup's own storage folder (a direct upload — a Vercel function cannot take
//                  a large body); this route READS it back and checks, on the server, that it is a real PDF (by its bytes, not its name),
//                  within the question's size limit and not flagged by the malware scan. Anything else is deleted at once.
//   kind "vault":  the applicant chose a document of their Vault. The authorisation is recorded IN THE NAME OF THE CALL (never of an
//                  evaluator) and pins the version that exists now; the submission copies those exact bytes, so a later change in the
//                  Vault never changes what was submitted. A newer version is offered (with a confirmation) until the application is submitted.
// One file per question: a new one replaces the old one.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { addFile, loadFiles, loadVaultPdf, objectSize, removeFileRow } from '@/lib/calls/applicant/store';
import { fileAnswer } from '@/lib/calls/applicant/answers';
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING } from '@/lib/calls/types';
import { logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BUCKET = 'data-room';

export const POST = withActingOrg(async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  if (a.app.status !== 'draft') return NextResponse.json({ ok: false, code: 'not_draft', error: 'This application was submitted: it can no longer be changed.' }, { status: 409 });
  const { data: accepting } = await a.admin.rpc('call_accepting', { p_call: a.call.id });
  if (accepting !== true) return NextResponse.json({ ok: false, code: 'closed', error: 'This call is no longer accepting applications.' }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { fieldId?: unknown; kind?: unknown; storagePath?: unknown; fileName?: unknown; documentId?: unknown };
  const field = a.fields.find((f) => f.id === body.fieldId);
  if (!field || field.kind !== 'file') return NextResponse.json({ ok: false, error: 'That is not a document question of this call.' }, { status: 400 });
  const maxMb = Math.min(field.validations.maxFileMb ?? DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING);
  const tooBig = (bytes: number) => bytes > maxMb * 1024 * 1024;

  // Replace what was there: its row goes (an uploaded object is removed from storage once the new one is in).
  const previous = (await loadFiles(a.admin, a.app.id)).filter((f) => f.fieldId === field.id);
  const dropPrevious = async () => {
    for (const p of previous) {
      await removeFileRow(a.admin, a.app.id, p.id);
      if (p.source === 'upload') await a.admin.storage.from(BUCKET).remove([p.storagePath]);
    }
  };

  if (body.kind === 'upload') {
    const path = typeof body.storagePath === 'string' ? body.storagePath : '';
    const name = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) : '';
    // The path must be this startup's own folder, resolved on the server — never a path the browser merely names.
    if (!name || !path.startsWith(`${a.orgId}/`) || path.includes('..')) return NextResponse.json({ ok: false, error: 'That upload does not belong to your startup.' }, { status: 403 });
    const { data: blob, error: dlErr } = await a.admin.storage.from(BUCKET).download(path);
    if (dlErr || !blob) return NextResponse.json({ ok: false, error: 'We could not read the uploaded file. Please try again.' }, { status: 400 });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const reject = async (error: string) => { await a.admin.storage.from(BUCKET).remove([path]); return NextResponse.json({ ok: false, error }, { status: 400 }); };
    if (detectAllowedKind(bytes, name) !== 'pdf' || !name.toLowerCase().endsWith('.pdf')) return reject('Only PDF files are accepted.');
    if (tooBig(bytes.length)) return reject(`The file is too large (maximum ${maxMb} MB).`);
    const verdict = await scanWithVirusTotal(bytes);
    if (verdict.status === 'flagged') return reject(`Upload blocked: ${verdict.detail}`);
    const row = await addFile(a.admin, {
      applicationId: a.app.id, callId: a.call.id, orgId: a.orgId, fieldId: field.id, source: 'upload', fileName: name, size: bytes.length, sha256: sha256Hex(bytes), storagePath: path, userId: a.userId,
    });
    if (!row) return reject('We could not attach the file. Please try again.');
    await dropPrevious();
    return NextResponse.json({ ok: true, file: { id: row.id, fieldId: row.fieldId, source: row.source, fileName: row.fileName, size: row.size }, answer: fileAnswer(row) });
  }

  if (body.kind === 'vault') {
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    const doc = documentId ? await loadVaultPdf(a.admin, a.orgId, documentId) : null;
    if (!doc) return NextResponse.json({ ok: false, error: 'That document is not available in your Vault as a PDF.' }, { status: 404 });
    const size = doc.sizeBytes ?? (await objectSize(a.admin, doc.storagePath));
    if (size === null) return NextResponse.json({ ok: false, error: 'We could not read the size of that document. Please try another or upload it.' }, { status: 400 });
    if (tooBig(size)) return NextResponse.json({ ok: false, error: `The file is too large (maximum ${maxMb} MB).` }, { status: 400 });
    const row = await addFile(a.admin, {
      applicationId: a.app.id, callId: a.call.id, orgId: a.orgId, fieldId: field.id, source: 'vault', fileName: doc.name, size, sha256: doc.sha256, storagePath: doc.storagePath,
      documentId: doc.id, versionId: doc.versionId, versionNumber: doc.version, userId: a.userId,
    });
    if (!row) return NextResponse.json({ ok: false, error: 'We could not attach the document. Please try again.' }, { status: 500 });
    await dropPrevious();
    await logCallEvent(a.admin, a.call.id, 'vault_document_authorised', a.userId, { applicationId: a.app.id, documentId: doc.id, version: doc.version, authorisedFor: 'call' });
    return NextResponse.json({ ok: true, file: { id: row.id, fieldId: row.fieldId, source: row.source, fileName: row.fileName, size: row.size, versionNumber: row.versionNumber, documentId: row.documentId }, answer: fileAnswer(row) });
  }

  return NextResponse.json({ ok: false, error: 'kind must be "upload" or "vault".' }, { status: 400 });
});
