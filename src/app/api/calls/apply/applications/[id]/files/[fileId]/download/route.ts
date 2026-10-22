// Prompt 918 (Adenda 2, C) — an applicant downloads a file of THEIR OWN application: what they attached to a draft, or — once submitted — the frozen copy that was kept at submission. Meant above all for
// the 30 days after a call is deleted, when the applicants have been told to take what they submitted; it works for any application of the caller's startup (a 404, never a 403, for anyone else's).
// The bytes pass through this route; no Storage address ever reaches the browser. Reading is allowed on a deleted call (authApplication lets a GET through).
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { loadFiles } from '@/lib/calls/applicant/store';
import { logMediaFailure } from '@/lib/calls/media-log';
import { streamStorageObject } from '@/lib/document-proxy';

export const dynamic = 'force-dynamic';

export const GET = withActingOrg(async function GET(req: Request, { params }: { params: { id: string; fileId: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  const file = (await loadFiles(a.admin, a.app.id)).find((f) => f.id === params.fileId);
  if (!file) return NextResponse.json({ ok: false }, { status: 404 });
  // A Vault file points at the Vault's own object until the submission; what was submitted is the frozen copy, which is what the applicant gets.
  const path = file.frozenPath ?? file.storagePath;
  return streamStorageObject({
    admin: a.admin, storagePath: path, filename: file.fileName, req,
    onFailure: logMediaFailure({ where: 'applicant', kind: 'application_file', callId: a.call.id, path }),
  });
});
