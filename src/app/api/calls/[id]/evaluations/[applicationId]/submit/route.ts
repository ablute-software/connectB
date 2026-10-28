// Prompt 922 (I3) — "Submit evaluation": every criterion scored and the required comments written, or a sentence saying what is missing (422 with the list). Once submitted it is read-only; only an administrator reopens it.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';
import { gateFor, submitEvaluation } from '@/lib/calls/eval-store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const gate = await gateFor(auth, params.applicationId);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const body = await req.json().catch(() => ({})) as { revision?: number };
  const r = await submitEvaluation(auth, gate, typeof body.revision === 'number' ? body.revision : undefined);
  if (!r.ok) { const { status, ...rest } = r; return NextResponse.json(rest, { status }); }
  return NextResponse.json({ ok: true, gradePercent: r.gradePercent, submittedAt: r.submittedAt });
}
