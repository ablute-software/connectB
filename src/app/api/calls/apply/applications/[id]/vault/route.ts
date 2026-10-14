// Prompt 907 (I2) — the startup's own Vault documents an applicant may attach to a "document" question: PDFs that are real files and were
// not flagged by the malware scan. Names, versions and sizes only.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { listVaultPdfs } from '@/lib/calls/applicant/store';

export const dynamic = 'force-dynamic';

export const GET = withActingOrg(async function GET(req: Request, { params }: { params: { id: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  const docs = await listVaultPdfs(a.admin, a.orgId);
  return NextResponse.json({ ok: true, documents: docs.map((d) => ({ id: d.id, name: d.name, version: d.version, sizeBytes: d.sizeBytes })) });
});
