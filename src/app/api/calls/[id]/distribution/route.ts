// Prompt 922 (I2) — the administrator's distribution screen: who evaluates what, the load of each evaluator, the applications without enough evaluators, the conflicts (automatic and declared, with the reason a
// person gave — visible here only), "Redistribute" with a preview, the mode, and assigning by hand where the mode allows. Only whoever may "Configure call"; every move is recorded in the call's events.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { saveAlloc } from '@/lib/calls/eval-alloc-store';
import { parseAlloc } from '@/lib/calls/eval-allocation';
import { NOT_READY_BODY, evaluationCounts, evaluationReady } from '@/lib/calls/eval-grid-store';
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
  const body = await req.json().catch(() => ({})) as { action?: string; mode?: string; applicationId?: string; userId?: string; baseRev?: number; config?: unknown; confirm?: boolean };
  const view = async () => buildDistributionView(auth.admin, await gather(auth.admin, auth.call));

  if (body.action === 'mode') {
    if (!MODES.includes(body.mode as DistributionMode)) return NextResponse.json({ ok: false, error: 'Choose Automatic, Mixed or Manual.' }, { status: 400 });
    await saveMode(auth.admin, auth.call.id, body.mode as DistributionMode, auth.userId);
    await logCallEvent(auth.admin, auth.call.id, 'eval_distribution_mode', auth.userId, { mode: body.mode });
    return NextResponse.json({ ok: true, ...(await view()) });
  }
  // Adenda 1, C — how the load is shared: Equal, Weighted or By rules. Saved while it is built (the screen says what is missing); the first submitted evaluation freezes it: a change makes a new version and asks first.
  if (body.action === 'allocation') {
    if (!Number.isInteger(body.baseRev)) return NextResponse.json({ ok: false, error: 'Missing baseRev.' }, { status: 400 });
    const parsed = parseAlloc(body.config);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    const counts = await evaluationCounts(auth.admin, auth.call.id);
    const r = await saveAlloc(auth.admin, auth.call.id, body.baseRev as number, parsed.config, auth.userId, { submitted: counts.submitted, confirm: body.confirm === true });
    if (!r.ok) return NextResponse.json({ ok: false, code: r.code, error: r.error, ...(r.extra ?? {}) }, { status: r.status });
    await logCallEvent(auth.admin, auth.call.id, 'eval_distribution_rules', auth.userId, { strategy: parsed.config.strategy, version: r.state.version, newVersion: r.versioned, panels: parsed.config.panels.length, rules: parsed.config.rules.length });
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
      allocation: p.allocation ? { ...p.allocation, unassigned: p.allocation.unassigned.map((id) => ({ applicationId: id, reference: ref(id) })), evaluators: p.allocation.evaluators.map((e) => ({ ...e, name: name(e.userId) })), panels: p.allocation.panels.map((x) => ({ ...x, evaluators: x.evaluators.map((e) => ({ ...e, name: name(e.userId) })) })) } : null,
    });
  }
  if (body.action === 'redistribute') {
    // Weighted / By rules cannot be applied while they are incomplete: the screen says what is missing, and the server holds the same line.
    const pre = await previewRedistribution(auth.admin, auth.call);
    const al = pre.p.allocation;
    if (al && (al.problems.length > 0 || al.needsChoice.length > 0)) return NextResponse.json({ ok: false, code: 'rules_incomplete', error: al.problems[0] ?? pre.p.warning ?? 'The distribution rules are not complete yet.' }, { status: 409 });
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
