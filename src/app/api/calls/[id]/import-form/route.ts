// Prompt 909 (I2) — import the form of another call of the SAME organisation (archived ones included), without AI.
//   GET  ?preview=<callId>   the calls you may import from (name, state, number of fields) and, with preview, the
//                            fields of one of them, to look at before confirming
//   POST { sourceCallId, mode: 'replace' | 'add', baseVersion, confirmReplace? }
// Only while the configuration is unlocked (a draft, or after "Edit configuration"), like every change to the form.
// Needs the permission to configure the call. A condition that points at a question that did not come is removed
// and reported. An event records where the form came from.
import { NextResponse, type NextRequest } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { parseFieldsPayload } from '@/lib/calls/form-builder';
import { importForm, isImportMode, type ImportSource } from '@/lib/calls/form-import';
import { effectiveStatus } from '@/lib/calls/lifecycle';
import { bumpConfig, listPromoterCalls, loadCall, loadFields, logCallEvent, replaceFields } from '@/lib/calls/store';
import { buildCallState } from '@/lib/calls/state';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  const cards = await listPromoterCalls(auth.admin, auth.call.promoterKind, auth.call.promoterId);
  const now = new Date();
  const sources: ImportSource[] = cards.filter((c) => c.call.id !== auth.call.id)
    .map((c) => ({ id: c.call.id, name: c.call.name, status: c.call.status, effectiveStatus: effectiveStatus(c.call, now), fields: c.fields, phases: c.phases }));

  const previewId = req.nextUrl.searchParams.get('preview');
  if (!previewId) return NextResponse.json({ ok: true, sources });
  if (!sources.some((s) => s.id === previewId)) return NextResponse.json({ ok: false, error: 'That call is not one of your organisation’s calls.' }, { status: 404 });
  const call = cards.find((c) => c.call.id === previewId)!.call;
  return NextResponse.json({ ok: true, sources, preview: { id: previewId, name: call.name, currency: call.currency, fields: await loadFields(auth.admin, previewId) } });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as { sourceCallId?: string; mode?: string; baseVersion?: number; confirmReplace?: boolean };

  if (auth.call.status !== 'draft') {
    return NextResponse.json({ ok: false, code: 'locked', error: 'The form is locked. Use “Edit configuration” before the call opens; once it is open the questions cannot change.' }, { status: 409 });
  }
  if (!isImportMode(body.mode)) return NextResponse.json({ ok: false, error: 'Choose “Replace current form” or “Add after current form”.' }, { status: 400 });
  if (!Number.isInteger(body.baseVersion)) return NextResponse.json({ ok: false, error: 'Missing baseVersion.' }, { status: 400 });
  if (typeof body.sourceCallId !== 'string' || body.sourceCallId === auth.call.id) {
    return NextResponse.json({ ok: false, error: 'Choose another call to import the form from.' }, { status: 400 });
  }

  // The source must belong to the same organisation; anything else answers as if it did not exist.
  const source = await loadCall(auth.admin, body.sourceCallId);
  if (!source || source.promoterKind !== auth.call.promoterKind || source.promoterId !== auth.call.promoterId) {
    return NextResponse.json({ ok: false, error: 'That call is not one of your organisation’s calls.' }, { status: 404 });
  }
  const [sourceFields, currentFields] = await Promise.all([loadFields(auth.admin, source.id), loadFields(auth.admin, auth.call.id)]);
  if (sourceFields.length === 0) return NextResponse.json({ ok: false, error: 'That call has no form to import.' }, { status: 409 });
  if (body.mode === 'replace' && currentFields.length > 0 && body.confirmReplace !== true) {
    return NextResponse.json({
      ok: false, code: 'confirm_replace', existingFields: currentFields.length,
      error: `This replaces the ${currentFields.length} field${currentFields.length === 1 ? '' : 's'} of the current form. Confirm to continue.`,
    }, { status: 409 });
  }

  const result = importForm(currentFields, sourceFields, body.mode);
  const parsed = parseFieldsPayload(result.fields);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const updated = await bumpConfig(auth.admin, auth.call, body.baseVersion as number);
  if (!updated) return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed this call. Reload to see their changes.' }, { status: 409 });
  await replaceFields(auth.admin, auth.call.id, parsed.fields);
  await logCallEvent(auth.admin, auth.call.id, 'form_imported', auth.userId, {
    fromCallId: source.id, fromName: source.name, mode: body.mode, imported: result.imported, warnings: result.warnings.length,
  });
  return NextResponse.json({ ...(await buildCallState(auth.admin, updated, auth.promoter)), import: { imported: result.imported, mode: body.mode, from: source.name, warnings: result.warnings } });
}
