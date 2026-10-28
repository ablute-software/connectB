// Prompt 922 (I2) — the administrator's distribution screen: who evaluates what, the load of each evaluator, the applications without enough evaluators, the conflicts (automatic and declared, with the reason a
// person gave — visible here only), "Redistribute" with a preview, the mode, and assigning by hand where the mode allows. Only whoever may "Configure call"; every move is recorded in the call's events.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';
import { assignByHand, buildDistributionView, gather, previewRedistribution, redistributeAll, saveMode, unassignByHand, type DistributionMode } from '@/lib/calls/eval-assign-store';
import { logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

const MODES: DistributionMode[] = ['auto', 'manual', 'mixed'];

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'configure' });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const g = await gather(auth.admin, auth.call);
  return NextResponse.json({ ok: true, ...(await buildDistributionView(auth.admin, g)) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  if (auth.call.status === 'archived' || auth.call.evaluationClosedAt) return NextResponse.json({ ok: false, error: 'The evaluation is closed: nothing can be distributed any more.' }, { status: 409 });
  const body = await req.json().catch(() => ({})) as { action?: string; mode?: string; applicationId?: string; userId?: string };
  const view = async () => buildDistributionView(auth.admin, await gather(auth.admin, auth.call));

  if (body.action === 'mode') {
    if (!MODES.includes(body.mode as DistributionMode)) return NextResponse.json({ ok: false, error: 'Choose Automatic, Mixed or Manual.' }, { status: 400 });
    await saveMode(auth.admin, auth.call.id, body.mode as DistributionMode, auth.userId);
    await logCallEvent(auth.admin, auth.call.id, 'eval_distribution_mode', auth.userId, { mode: body.mode });
    return NextResponse.json({ ok: true, ...(await view()) });
  }
  if (body.action === 'preview') {
    const { g, p } = await previewRedistribution(auth.admin, auth.call);
    const name = (id: string) => g.evaluators.find((e) => e.userId === id)?.name ?? g.evaluators.find((e) => e.userId === id)?.email ?? 'Someone';
    const ref = (id: string) => g.apps.find((a) => a.applicationId === id)?.reference ?? 'an application';
    return NextResponse.json({
      ok: true, manual: g.mode === 'manual', warning: p.warning,
      remove: p.remove.map((r) => ({ applicationId: r.applicationId, reference: ref(r.applicationId), userId: r.userId, evaluator: name(r.userId), why: r.why })),
      add: p.add.map((a) => ({ applicationId: a.applicationId, reference: ref(a.applicationId), userId: a.userId, evaluator: name(a.userId) })),
      keptWithConflict: p.keptWithConflict.map((k) => ({ applicationId: k.applicationId, reference: ref(k.applicationId), userId: k.userId, evaluator: name(k.userId) })),
      shortfalls: p.shortfalls.map((s) => ({ ...s, reference: ref(s.applicationId) })), loads: p.loads, newConflicts: p.newConflicts.length,
    });
  }
  if (body.action === 'redistribute') {
    const r = await redistributeAll(auth.admin, auth.call, auth.userId);
    return NextResponse.json({ ok: true, removed: r.applied.removed, added: r.applied.added, ...(await view()) });
  }
  if ((body.action === 'assign' || body.action === 'unassign') && typeof body.applicationId === 'string' && typeof body.userId === 'string') {
    const r = body.action === 'assign' ? await assignByHand(auth.admin, auth.call, body.applicationId, body.userId, auth.userId) : await unassignByHand(auth.admin, auth.call, body.applicationId, body.userId, auth.userId);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, ...(await view()) });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
