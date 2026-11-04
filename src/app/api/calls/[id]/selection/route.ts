// Prompt 925 — the rules of the selection (Setup → "Selection rules"): read by whoever may configure the call or take the final decision, changed only by whoever may "Configure call", until the evaluation is
// closed (and never once the results are published). A change makes a new VERSION of the rules; the old ones stay. The server checks every rule against the form and the grid: nothing that points at nothing is saved.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady, loadCriteria, loadSettings } from '@/lib/calls/eval-grid-store';
import { scoringOf } from '@/lib/calls/eval-grid';
import { loadFields } from '@/lib/calls/store';
import { SELECTABLE_KINDS, parseRules } from '@/lib/calls/selection';
import { loadRules, saveRules, selectionLocked } from '@/lib/calls/selection-store';

export const dynamic = 'force-dynamic';

async function context(admin: Parameters<typeof loadFields>[0], call: { id: string; evalGridVersion?: number | null }) {
  const [fields, criteria, settings] = await Promise.all([loadFields(admin, call.id), loadCriteria(admin, call.id, call.evalGridVersion ?? 1), loadSettings(admin, call.id)]);
  return { fields, criteria, scoring: scoringOf(settings) };
}
const lockReason = async (admin: Parameters<typeof selectionLocked>[0], call: { id: string; evaluationClosedAt?: string | null }): Promise<string | null> =>
  (await selectionLocked(admin, call.id)) ? 'The results were published: the selection rules are fixed.' : call.evaluationClosedAt ? 'The evaluation is closed: the selection rules can no longer change. Reopen the evaluation to change them.' : null;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.configure_call && !auth.perms.final_decision) return NextResponse.json({ ok: false, error: 'You do not have the “Configure call” or “Final decision” permission on this call.' }, { status: 403 });
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const [stored, ctx, locked] = await Promise.all([loadRules(auth.admin, auth.call.id), context(auth.admin, auth.call), lockReason(auth.admin, auth.call)]);
  return NextResponse.json({
    ok: true, canEdit: auth.perms.configure_call && !locked && auth.call.status !== 'archived', lockedReason: locked, version: stored.version, rules: stored.rules, criteria: ctx.criteria, scoring: ctx.scoring,
    fields: ctx.fields.filter((f) => (SELECTABLE_KINDS as readonly string[]).includes(f.kind)).map((f) => ({ id: f.id, label: f.label, kind: f.kind, options: f.options.map((o) => ({ id: o.id, label: o.label })) })),
  });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  if (auth.call.status === 'archived') return NextResponse.json({ ok: false, error: 'An archived call cannot be changed.' }, { status: 409 });
  const locked = await lockReason(auth.admin, auth.call);
  if (locked) return NextResponse.json({ ok: false, code: 'locked', error: locked }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { rules?: unknown; baseVersion?: unknown };
  if (!Number.isInteger(body.baseVersion)) return NextResponse.json({ ok: false, error: 'Missing baseVersion.' }, { status: 400 });
  const ctx = await context(auth.admin, auth.call);
  const parsed = parseRules(body.rules, { fields: ctx.fields, criteria: ctx.criteria });
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const saved = await saveRules(auth.admin, auth.call, parsed.rules, body.baseVersion as number, auth.userId);
  if (!saved) return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed the selection rules. Reload to see their changes.' }, { status: 409 });
  return NextResponse.json({ ok: true, version: saved.version, rules: saved.rules });
}
