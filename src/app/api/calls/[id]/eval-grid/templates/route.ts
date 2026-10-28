// Prompt 922 (I1) — grid templates, at the level of the ENTITY: "Save as template" keeps the current grid (criteria and settings, nothing that belongs to this call) under a name; the list is the templates of the
// organisation this call belongs to. Using one is a COPY into the call (see templates/[templateId]).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { NOT_READY_BODY, evaluationReady, listTemplates, loadCriteria, loadSettings, saveTemplate } from '@/lib/calls/eval-grid-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  return NextResponse.json({ ok: true, templates: await listTemplates(auth.admin, auth.call) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const body = await req.json().catch(() => ({})) as { name?: unknown };
  const criteria = await loadCriteria(auth.admin, auth.call.id, auth.call.evalGridVersion ?? 1);
  if (criteria.length === 0) return NextResponse.json({ ok: false, error: 'There is no grid to save yet.' }, { status: 409 });
  const r = await saveTemplate(auth.admin, auth.call, String(body.name ?? ''), criteria, await loadSettings(auth.admin, auth.call.id), auth.userId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.error.startsWith('The organisation') ? 409 : 400 });
  return NextResponse.json({ ok: true, id: r.id, templates: await listTemplates(auth.admin, auth.call) });
}
