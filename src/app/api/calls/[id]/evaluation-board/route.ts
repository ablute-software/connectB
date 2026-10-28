// Prompt 922 (I4) — the evaluation board of a call: progress, the ranking by weighted average, the average of each criterion, divergence and minimum flags, the decision. Read with "Configure call" or "Final decision";
// decide, close and reopen the evaluation need "Final decision" — checked here against the call's permissions, whatever the screen shows.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';
import { loadBoard, setClosed, setDecision } from '@/lib/calls/eval-board-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.configure_call && !auth.perms.final_decision) return NextResponse.json({ ok: false, error: 'You do not have the “Configure call” or “Final decision” permission on this call.' }, { status: 403 });
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  return NextResponse.json({ ok: true, canDecide: auth.perms.final_decision, ...(await loadBoard(auth.admin, auth.call)) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.final_decision) return NextResponse.json({ ok: false, error: 'You do not have the “Final decision & selection overrides” permission on this call.' }, { status: 403 });
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  if (auth.call.status === 'archived') return NextResponse.json({ ok: false, error: 'An archived call cannot be changed.' }, { status: 409 });
  const body = await req.json().catch(() => ({})) as { action?: string; applicationId?: unknown; decision?: unknown; note?: unknown };
  let r: { ok: true } | { ok: false; status: number; error: string };
  if (body.action === 'decide' && typeof body.applicationId === 'string') r = await setDecision(auth.admin, auth.call, body.applicationId, body.decision ?? null, body.note, auth.userId);
  else if (body.action === 'close') r = await setClosed(auth.admin, auth.call, true, auth.userId);
  else if (body.action === 'reopen') r = await setClosed(auth.admin, auth.call, false, auth.userId);
  else return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  const fresh = await authCall(params.id);
  if (fresh.error) return fresh.error;
  return NextResponse.json({ ok: true, canDecide: true, ...(await loadBoard(fresh.admin, fresh.call)) });
}
