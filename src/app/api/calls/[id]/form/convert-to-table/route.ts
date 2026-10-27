// Prompt 917 (Adenda 2, B4) — "Convert to Table": a repeatable group shown as a table with rows the entity set (what the import used to make of a competitive-analysis template: the companies as fixed
// rows, the criteria as columns, the wrong way round) becomes a TABLE, transposed: the fixed rows become columns, the questions become criteria (rows), and applicants can add columns.
//
//   POST { fieldId, confirm? }
//
// It works in ANY state but archived — the form of an open call is otherwise locked, and this is the one change that is allowed there, on purpose, because the shape of this one question was wrong:
//   - drafts are MIGRATED (the entries of the group become the columns of the table; the entry ids stay as the column ids) and every draft's revision moves, so an application open in another window
//     reloads instead of overwriting; a draft whose answer cannot be carried over is told so (a notice and an email: which question changed);
//   - SUBMITTED applications are untouched: each keeps the form it was submitted with (its own snapshot), so what was submitted can never be altered;
//   - with submissions already in, it asks for an explicit confirmation first (409 `needs_confirm` with the sentence to show).
// Only whoever may "Configure call". Recorded in the call's history.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { notifyFormChanged } from '@/lib/calls/applicant/notices';
import { convertGroupToTable } from '@/lib/calls/table';
import { bumpConfig, countApplications, loadFields, logCallEvent, replaceFields } from '@/lib/calls/store';
import { buildCallState } from '@/lib/calls/state';
import type { AnswerValue, FormField } from '@/lib/calls/types';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as { fieldId?: string; confirm?: boolean };
  if (auth.call.status === 'archived') return NextResponse.json({ ok: false, error: 'An archived call cannot be changed.' }, { status: 409 });

  const fields = await loadFields(auth.admin, auth.call.id);
  const field = fields.find((f) => f.id === body.fieldId);
  if (!field) return NextResponse.json({ ok: false, error: 'That question does not exist.' }, { status: 404 });
  const conv = convertGroupToTable(field);
  if (!conv.ok) return NextResponse.json({ ok: false, code: 'not_convertible', error: conv.reason }, { status: 409 });

  const counts = await countApplications(auth.admin, auth.call.id);
  const submitted = counts.submitted + counts.withdrawn;
  if (submitted > 0 && body.confirm !== true) {
    return NextResponse.json({
      ok: false, code: 'needs_confirm', submitted, drafts: counts.inProgress,
      error: `${submitted} application${submitted === 1 ? ' has' : 's have'} already been submitted. ${submitted === 1 ? 'It keeps' : 'They keep'} this question exactly as it was submitted (a repeatable group); new and unfinished applications will get the table. Convert it anyway?`,
    }, { status: 409 });
  }

  // The question: same id, same text and position, now a table.
  const converted: FormField = { ...field, kind: 'table', options: [], validations: { table: conv.table }, platformMapping: null, expectedType: null, maxAgeMonths: null };
  // A draft call moves its version (an editor open in another window then reloads); the version of a call that was confirmed or opened is left alone — it is not the configuration being edited.
  const bumped = auth.call.status === 'draft' ? await bumpConfig(auth.admin, auth.call, auth.call.configVersion) : auth.call;
  if (!bumped) return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed this call. Reload and try again.' }, { status: 409 });
  await replaceFields(auth.admin, auth.call.id, fields.map((f) => (f.id === field.id ? converted : f)));

  // Drafts: carry the answer over; a draft whose answer did not fit is told.
  const { data: drafts } = await auth.admin.from('call_applications').select('id, applicant_user_id, draft_answers, draft_revision').eq('call_id', auth.call.id).eq('status', 'draft');
  let migrated = 0; let told = 0;
  for (const d of (drafts ?? []) as Row[]) {
    const answers = { ...((d.draft_answers as Record<string, AnswerValue> | null) ?? {}) };
    const had = answers[field.id];
    const hadContent = Array.isArray(had) && (had as { values?: Record<string, unknown> }[]).some((e) => e && e.values && Object.values(e.values).some((v) => typeof v === 'string' && v.trim() !== ''));
    delete answers[field.id];
    const carried = conv.answer(had as AnswerValue);
    if (carried) { answers[field.id] = carried; migrated++; }
    await auth.admin.from('call_applications').update({ draft_answers: answers, draft_revision: Number(d.draft_revision ?? 0) + 1, updated_at: new Date().toISOString() }).eq('id', d.id as string);
    if (hadContent && !carried) {
      const ok = await notifyFormChanged(auth.admin, bumped, d.applicant_user_id as string, d.id as string, field.label).catch((e) => { console.error('[calls] form-changed notice failed:', (e as Error).message); return false; });
      if (ok) told++;
    }
  }
  await logCallEvent(auth.admin, auth.call.id, 'field_converted_to_table', auth.userId, { fieldId: field.id, label: field.label, drafts: counts.inProgress, migrated, told, submitted });
  const state = await buildCallState(auth.admin, bumped, auth.promoter);
  return NextResponse.json({ ...state, converted: { label: field.label, summary: conv.summary, drafts: counts.inProgress, migrated, told, submitted } });
}
