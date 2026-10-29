// Prompt 924 (Etapa 4, I3) — completing the call, and how long the applicants' data is kept. For whoever may "Publish results" (checked here on every request).
//
//   GET                                    whether the call can be completed (every phase published, the contestation period over, no contestation open), and the retention: the date the data goes,
//                                          the warning 30 days before, whether it was already postponed
//   POST { action: 'complete', confirmName }   "Complete call": from then on everything is read-only; the retention starts (24 months by default)
//        { action: 'postpone', reason }        postpone the deletion ONCE, with a reason, before it is due (the one write that still makes sense on a completed call)
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { RESULTS_NOT_READY, resultsReady } from '@/lib/calls/results-store';
import { completeCall, loadClose, postponeRetention } from '@/lib/calls/contestations-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'publish_results', allowCompleted: true });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  return NextResponse.json(await loadClose(auth.admin, auth.call));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'publish_results', allowCompleted: true });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  const body = await req.json().catch(() => ({})) as { action?: string; confirmName?: unknown; reason?: unknown };
  const fresh = async () => { const c = await authCall(params.id, { need: 'publish_results', allowCompleted: true }); return c.error ? c.error : NextResponse.json(await loadClose(c.admin, c.call)); };
  if (body.action === 'complete') {
    const r = await completeCall(auth.admin, auth.call, auth.userId, body.confirmName);
    return r.ok ? fresh() : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  }
  if (body.action === 'postpone') {
    const r = await postponeRetention(auth.admin, auth.call, body.reason, auth.userId);
    return r.ok ? fresh() : NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
