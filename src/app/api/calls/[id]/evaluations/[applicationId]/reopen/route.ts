// Prompt 922 (I3) — an administrator reopens a SUBMITTED evaluation, with a reason that is kept with what was there; the evaluator is told. Only "Configure call".
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';
import { reopenEvaluation } from '@/lib/calls/eval-store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const body = await req.json().catch(() => ({})) as { evaluatorUserId?: unknown; reason?: unknown };
  if (typeof body.evaluatorUserId !== 'string') return NextResponse.json({ ok: false, error: 'Say whose evaluation to reopen.' }, { status: 400 });
  const r = await reopenEvaluation(auth, params.applicationId, body.evaluatorUserId, typeof body.reason === 'string' ? body.reason : '');
  if (!r.ok) { const { status, ...rest } = r; return NextResponse.json(rest, { status }); }
  return NextResponse.json({ ok: true });
}
