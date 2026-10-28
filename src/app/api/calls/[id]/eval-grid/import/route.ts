// Prompt 922 (I1) — "Import the grid from a document" (PDF, Word or Excel), with the platform's OWN reader only. Evaluation grids are confidential to the entity and are NEVER sent to an AI provider: there is no
// provider here and no fallback to one. The file is read in memory and not kept; the proposal (each criterion with where it was read) is stored for this call and returned for the administrator to verify.
// Only whoever may "Configure call", and only while the grid can still be edited.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { GRID_IMPORT_MAX_BYTES, GRID_NOTICE, readGridDocument } from '@/lib/calls/eval-grid-import';
import { proposalToCriteria } from '@/lib/calls/eval-grid-reader';
import { NOT_READY_BODY, evaluationCounts, evaluationReady, saveImportRun } from '@/lib/calls/eval-grid-store';
import { gridMode } from '@/lib/calls/eval-grid-view';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const mode = gridMode(auth.call.status, (await evaluationCounts(auth.admin, auth.call.id)).submitted);
  if (mode === 'locked' || mode === 'archived') return NextResponse.json({ ok: false, code: 'locked', error: 'The evaluation grid cannot be changed now.' }, { status: 409 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string' || typeof (file as File).arrayBuffer !== 'function') return NextResponse.json({ ok: false, error: 'Choose a PDF, Word or Excel file.' }, { status: 400 });
  const f = file as File;
  if (f.size > GRID_IMPORT_MAX_BYTES) return NextResponse.json({ ok: false, error: 'The file is too large (10 MB at most).' }, { status: 413 });
  const reading = await readGridDocument(f.name || 'grid', Buffer.from(await f.arrayBuffer()));
  if (!reading.ok) return NextResponse.json({ ok: false, error: reading.error }, { status: 422 });
  const runId = await saveImportRun(auth.admin, auth.call.id, f.name || 'grid', reading.proposal, auth.userId);
  return NextResponse.json({ ok: true, runId, notice: GRID_NOTICE, fileName: f.name, proposal: reading.proposal, criteria: proposalToCriteria(reading.proposal) });
}
