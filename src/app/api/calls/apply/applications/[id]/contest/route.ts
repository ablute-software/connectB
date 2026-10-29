// Prompt 924 (Etapa 4, I3) — an applicant contests the decision on THEIR application: a written reason (required) and at most one file (a PDF the browser already put in the startup's own folder; this route reads it back
// and checks its bytes). Only for a "Not selected", only while the call lets them and within the period (10 calendar days after the results were published, once on), and ONCE per application and phase.
// Another startup's application is a 404, like every applicant route.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { createContestation } from '@/lib/calls/contestations-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = withActingOrg(async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; storagePath?: unknown; fileName?: unknown };
  const r = await createContestation(a.admin, a.call, { applicationId: a.app.id, orgId: a.orgId, userId: a.userId }, body);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, contestation: r.contestation });
});
