// Prompt 925 — the PROPOSAL of the selection, on the evaluation board: read by whoever may configure the call or take the final decision; calculated, applied and tie-decided only by whoever has "Final decision &
// selection overrides". The proposal never decides anything by itself: "Apply" fills the decisions (origin "proposal"), a person can change any of them with a reason. After the results are published it is fixed.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';
import { applyRun, createRun, gatherInputs, latestRun, loadRules, selectionLocked, setManualOrder } from '@/lib/calls/selection-store';
import { ruleWarnings } from '@/lib/calls/selection';

export const dynamic = 'force-dynamic';

async function view(admin: Parameters<typeof loadRules>[0], call: Parameters<typeof gatherInputs>[1], canDecide: boolean) {
  const stored = await loadRules(admin, call.id);
  const inputs = await gatherInputs(admin, call, stored);
  const run = await latestRun(admin, call, stored, inputs);
  const rulesStale = !!run && run.rulesVersion !== stored.version;
  return {
    ok: true, canDecide, hasRules: stored.exists, rulesVersion: stored.version, locked: await selectionLocked(admin, call.id), run,
    missingEvaluations: inputs.board.rows.filter((r) => r.state !== 'complete').length, rulesStale,
    warnings: ruleWarnings(stored.rules, inputs.board.criteria, inputs.board.scoring), manualOrder: stored.manualOrder,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.configure_call && !auth.perms.final_decision) return NextResponse.json({ ok: false, error: 'You do not have the “Configure call” or “Final decision” permission on this call.' }, { status: 403 });
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  return NextResponse.json(await view(auth.admin, auth.call, auth.perms.final_decision));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.final_decision) return NextResponse.json({ ok: false, error: 'You do not have the “Final decision & selection overrides” permission on this call.' }, { status: 403 });
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  if (auth.call.status === 'archived') return NextResponse.json({ ok: false, error: 'An archived call cannot be changed.' }, { status: 409 });
  if (await selectionLocked(auth.admin, auth.call.id)) return NextResponse.json({ ok: false, code: 'locked', error: 'The results were published: the selection is fixed.' }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; runId?: unknown; order?: unknown };
  const stored = await loadRules(auth.admin, auth.call.id);

  if (body.action === 'propose' || body.action === 'ties') {
    if (!stored.exists) return NextResponse.json({ ok: false, error: 'Set the selection rules first (Setup → Selection rules).' }, { status: 400 });
    if (body.action === 'ties') {
      const order = Array.isArray(body.order) ? (body.order as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 2000) : null;
      if (!order || new Set(order).size !== order.length) return NextResponse.json({ ok: false, error: 'Send the applications in the order you decided, each once.' }, { status: 400 });
      if (!(await setManualOrder(auth.admin, auth.call, order, auth.userId))) return NextResponse.json({ ok: false, error: 'The order could not be saved.' }, { status: 500 });
    }
    const fresh = await loadRules(auth.admin, auth.call.id);
    await createRun(auth.admin, auth.call, fresh, await gatherInputs(auth.admin, auth.call, fresh), auth.userId);
    return NextResponse.json(await view(auth.admin, auth.call, true));
  }
  if (body.action === 'apply' && typeof body.runId === 'string') {
    const r = await applyRun(auth.admin, auth.call, body.runId, auth.userId);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json({ ...(await view(auth.admin, auth.call, true)), applied: { written: r.written, keptManual: r.keptManual, locked: r.locked, unchanged: r.unchanged } });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
