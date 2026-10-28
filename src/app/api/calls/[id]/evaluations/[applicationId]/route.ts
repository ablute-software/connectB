// Prompt 922 (I3) — ONE evaluation: GET the application (masked when the evaluation is blind), the grid version it was started on and what the evaluator has scored so far; PUT the autosave (only what changed,
// with the revision it was based on). Who may do what is decided in lib/calls/eval-store.ts — never here, never in the browser.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';
import { buildPayload, gateFor, saveDraft, type DraftInput } from '@/lib/calls/eval-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const gate = await gateFor(auth, params.applicationId);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  return NextResponse.json({ ok: true, ...(await buildPayload(auth, gate)) });
}

export async function PUT(req: Request, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const gate = await gateFor(auth, params.applicationId);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const body = await req.json().catch(() => null) as DraftInput | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'Nothing to save.' }, { status: 400 });
  const r = await saveDraft(auth, gate, body);
  if (!r.ok) { const { status, ...rest } = r; return NextResponse.json(rest, { status }); }
  return NextResponse.json({ ok: true, revision: r.revision, gradePercent: r.gradePercent });
}
