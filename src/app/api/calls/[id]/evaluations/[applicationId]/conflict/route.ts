// Prompt 922 (I2) — "I have a conflict": the evaluator says they cannot evaluate an application assigned to them. The reason is optional and only the administrator sees it. The assignment is removed, the unsent
// draft discarded and the application given to someone else when the mode allows. Only a person with "Evaluate assigned applications", and only for their own assignment (the server checks it).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { declareConflict } from '@/lib/calls/eval-assign-store';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.evaluate_assigned) return NextResponse.json({ ok: false, error: 'You do not have the “Evaluate assigned applications” permission on this call.' }, { status: 403 });
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  if (auth.call.evaluationClosedAt) return NextResponse.json({ ok: false, error: 'The evaluation is closed.' }, { status: 409 });
  const body = await req.json().catch(() => ({})) as { note?: unknown };
  const r = await declareConflict(auth.admin, auth.call, params.applicationId, auth.userId, typeof body.note === 'string' ? body.note : null);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
