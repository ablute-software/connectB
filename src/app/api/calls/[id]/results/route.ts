// Prompt 924 (Etapa 4, I1) — preparing the results of a call. Only whoever may "Publish results" (checked here on every request, whatever the screen shows).
//
//   GET                                      the preparation: what each application will be told (from the decisions of the evaluation board and the eligibility), who is still pending, the names
//                                            and messages of the results, the options (feedback, contestations, retention) and what blocks publishing
//   PUT   { labels?, messages?, includeEligibilityReason?, feedbackEnabled?, contestationsEnabled?, contestationDays?, retentionMonths?, nextStepsText?, nextStepsDate? }
//                                            changes only what is present
//   POST  { action: 'feedback', applicationId, text }     the feedback an administrator writes for one application ('' clears it)
//         { action: 'preview',  applicationId }           the message that application would receive with the settings as they are now — nothing is sent
// Nothing in here reaches an applicant: publishing is its own step.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { RESULTS_NOT_READY, loadPrepare, previewFor, resultsReady, saveSettings, setFeedback } from '@/lib/calls/results-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'publish_results' });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  return NextResponse.json(await loadPrepare(auth.admin, auth.call));
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'publish_results' });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  if (auth.call.status === 'archived') return NextResponse.json({ ok: false, error: 'An archived call cannot be changed.' }, { status: 409 });
  const r = await saveSettings(auth.admin, auth.call, await req.json().catch(() => null), auth.userId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json(await loadPrepare(auth.admin, auth.call));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'publish_results' });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  const body = await req.json().catch(() => ({})) as { action?: string; applicationId?: unknown; text?: unknown };
  if (typeof body.applicationId !== 'string') return NextResponse.json({ ok: false, error: 'Choose an application.' }, { status: 400 });
  if (body.action === 'preview') {
    const r = await previewFor(auth.admin, auth.call, body.applicationId);
    return r.ok ? NextResponse.json({ ok: true, message: r.message }) : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  }
  if (body.action === 'feedback') {
    if (auth.call.status === 'archived') return NextResponse.json({ ok: false, error: 'An archived call cannot be changed.' }, { status: 409 });
    const r = await setFeedback(auth.admin, auth.call, body.applicationId, body.text ?? null, auth.userId);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json(await loadPrepare(auth.admin, auth.call));
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
