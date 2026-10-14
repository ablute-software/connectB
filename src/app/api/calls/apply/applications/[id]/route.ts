// Prompt 907 (I2) — one application: read it (GET) and save its draft (PUT). The draft is saved on every change (the browser's autosave),
// on "Next" and on "Back"; the server keeps only the answers of this call's questions, each coerced to its type, and refuses the save
// when the application is no longer a draft, when the call no longer accepts applications (the server's clock), or when another window
// saved in between (compare-and-swap on the revision) — the browser then keeps what is on screen and offers to try again.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { sanitizeAnswers } from '@/lib/calls/applicant/answers';
import { buildApplicationState, loadApplication, loadFiles, resumePage, saveDraft } from '@/lib/calls/applicant/store';

export const dynamic = 'force-dynamic';

export const GET = withActingOrg(async function GET(req: Request, { params }: { params: { id: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  const state = await buildApplicationState(a.admin, a.call, a.fields, a.app, a.promoter);
  return NextResponse.json({ ok: true, state, page: resumePage(a.fields, state.answers, a.app.lastPage) });
});

export const PUT = withActingOrg(async function PUT(req: Request, { params }: { params: { id: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  if (a.app.status !== 'draft') return NextResponse.json({ ok: false, code: 'not_draft', error: 'This application was submitted: it can no longer be changed.' }, { status: 409 });
  const { data: accepting } = await a.admin.rpc('call_accepting', { p_call: a.call.id });
  if (accepting !== true) return NextResponse.json({ ok: false, code: 'closed', error: 'This call is no longer accepting applications.' }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { answers?: unknown; lastPage?: unknown; baseRevision?: unknown };
  if (typeof body.baseRevision !== 'number' || !Number.isInteger(body.baseRevision)) return NextResponse.json({ ok: false, error: 'baseRevision is required.' }, { status: 400 });
  const lastPage = typeof body.lastPage === 'number' && Number.isInteger(body.lastPage) && body.lastPage >= 1 && body.lastPage <= 200 ? body.lastPage : null;
  let answers;
  try { answers = sanitizeAnswers(a.fields, body.answers, await loadFiles(a.admin, a.app.id)); }
  catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 413 }); }

  const saved = await saveDraft(a.admin, a.app, answers, lastPage, body.baseRevision);
  if (!saved.ok) {
    if (saved.reason === 'conflict') {
      const fresh = await loadApplication(a.admin, a.app.id);
      return NextResponse.json({ ok: false, code: 'conflict', error: 'This application was changed in another window. Reload it to continue.', revision: fresh?.revision ?? null }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'We could not save. Please try again.' }, { status: saved.reason === 'not_draft' ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, revision: saved.revision });
});
