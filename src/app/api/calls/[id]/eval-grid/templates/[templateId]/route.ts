// Prompt 922 (I1) — "Start from template": the template's criteria as a COPY (new ids) for the editor to review and save as this call's grid — nothing is shared with the template or with another call afterwards.
// DELETE removes a template of the organisation. Only whoever may "Configure call".
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, deleteTemplate, evaluationCounts, evaluationReady, templateCriteria } from '@/lib/calls/eval-grid-store';
import { gridMode } from '@/lib/calls/eval-grid-view';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string; templateId: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const mode = gridMode(auth.call.status, (await evaluationCounts(auth.admin, auth.call.id)).submitted);
  if (mode === 'locked' || mode === 'archived') return NextResponse.json({ ok: false, code: 'locked', error: 'The evaluation grid cannot be changed now.' }, { status: 409 });
  const t = await templateCriteria(auth.admin, auth.call, params.templateId);
  if (!t) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, name: t.name, criteria: t.criteria });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; templateId: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  if (!(await deleteTemplate(auth.admin, auth.call, params.templateId))) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true });
}
