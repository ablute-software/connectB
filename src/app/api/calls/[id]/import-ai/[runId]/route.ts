// Prompt 909 (I4) — the review of a proposal. NOTHING from a proposal reaches the call's configuration except what the
// person Accepted (and may have edited): this route applies exactly the items it is sent, re-checked by the same
// validation the editor's own saves use, or discards the proposal.
//   POST { action: 'discard' }
//        { action: 'apply', baseVersion, accepted: { general?, phases?, fields? }, fieldsMode?: 'add' | 'replace' }
// General: only the fields sent. Phases: the accepted ones become the call's phases. Fields: added after the current
// form (or replacing it). Only while the configuration is unlocked. An event records what was applied.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { fieldItemsToFormFields, sanitizeFieldItems, sanitizeGeneral, sanitizePhases } from '@/lib/calls/ai-import/proposal';
import { closeRun, loadRun } from '@/lib/calls/ai-import/store';
import { parseFieldsPayload } from '@/lib/calls/form-builder';
import { parseGeneralPatch, parsePhasesPayload } from '@/lib/calls/mappers';
import { bumpConfig, loadFields, logCallEvent, replaceFields, replacePhases } from '@/lib/calls/store';
import { buildCallState } from '@/lib/calls/state';

export const dynamic = 'force-dynamic';

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });

export async function POST(req: Request, { params }: { params: { id: string; runId: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const run = await loadRun(auth.admin, auth.call.id, params.runId);
  if (!run) return bad('That proposal does not exist.', 404);
  if (run.status !== 'proposed') return bad(run.status === 'applied' ? 'This proposal was already applied.' : 'This proposal was discarded.', 409);
  const b = await req.json().catch(() => ({})) as { action?: string; baseVersion?: number; accepted?: Record<string, unknown>; fieldsMode?: string };

  if (b.action === 'discard') {
    await closeRun(auth.admin, run.id, 'discarded', auth.userId);
    await logCallEvent(auth.admin, auth.call.id, 'import_discarded', auth.userId, { runId: run.id });
    return NextResponse.json({ ok: true, discarded: true });
  }
  if (b.action !== 'apply') return bad('Unknown action.');
  if (auth.call.status !== 'draft') return bad('The configuration is locked. Use “Edit configuration” before the call opens; once it is open it cannot change.', 409, { code: 'locked' });
  if (!Number.isInteger(b.baseVersion)) return bad('Missing baseVersion.');

  const accepted = b.accepted && typeof b.accepted === 'object' ? b.accepted : {};
  const hasGeneral = accepted.general && typeof accepted.general === 'object' && Object.keys(accepted.general as object).length > 0;
  const hasPhases = Array.isArray(accepted.phases) && accepted.phases.length > 0;
  const hasFields = Array.isArray(accepted.fields) && accepted.fields.length > 0;
  if (!hasGeneral && !hasPhases && !hasFields) return bad('Nothing was accepted. Accept the items you want, then apply them.');

  // Everything the person accepted goes through the same checks as a save from the editor.
  let generalPatch: Record<string, unknown> = {};
  if (hasGeneral) {
    const g = sanitizeGeneral(accepted.general, { dropInconsistentDates: false });
    const parsed = parseGeneralPatch({ ...g }, auth.call);
    if (!parsed.ok) return bad(parsed.error);
    generalPatch = parsed.patch as Record<string, unknown>;
  }
  let phases: ReturnType<typeof parsePhasesPayload> | null = null;
  if (hasPhases) {
    phases = parsePhasesPayload(sanitizePhases(accepted.phases));
    if (!phases.ok) return bad(phases.error);
  }
  let fields: ReturnType<typeof parseFieldsPayload> | null = null;
  let fieldCount = 0;
  if (hasFields) {
    const items = sanitizeFieldItems(accepted.fields, { paged: false }).fields;
    const current = await loadFields(auth.admin, auth.call.id);
    const replace = b.fieldsMode === 'replace' || current.length === 0;
    const added = fieldItemsToFormFields(items, replace ? 0 : Math.max(0, ...current.map((f) => f.page)));
    fieldCount = added.length;
    fields = parseFieldsPayload(replace ? added : [...current, ...added]);
    if (!fields.ok) return bad(fields.error);
  }

  const updated = await bumpConfig(auth.admin, auth.call, b.baseVersion as number, generalPatch);
  if (!updated) return bad('Someone else changed this call. Reload to see their changes.', 409, { code: 'conflict' });
  if (phases?.ok) await replacePhases(auth.admin, auth.call.id, phases.phases);
  if (fields?.ok) await replaceFields(auth.admin, auth.call.id, fields.fields);
  await closeRun(auth.admin, run.id, 'applied', auth.userId);
  await logCallEvent(auth.admin, auth.call.id, 'import_applied', auth.userId, {
    runId: run.id, general: Object.keys(generalPatch).length, phases: phases?.ok ? phases.phases.length : 0, fields: fieldCount,
  });
  return NextResponse.json({ ...(await buildCallState(auth.admin, updated, auth.promoter)), applied: { general: Object.keys(generalPatch).length > 0, phases: phases?.ok ? phases.phases.length : 0, fields: fieldCount } });
}
