// Prompt 924 (Etapa 4, I2) — publishing the results of a call. Only whoever may "Publish results" (checked here on every request).
//
//   GET                                     the publication: counts, what would go out, what blocks it, the batch (scheduled / published) and the state of every email
//   POST  { action: 'test' }                one email of each result, with example data, to the person asking (never to an applicant)
//         { action: 'publish', confirmName }                  now, for ALL the applications of the phase at once; the name of the call is typed to confirm
//         { action: 'schedule', at, confirmName }             at a moment (an ISO time); decisions and settings are fixed until it is cancelled
//         { action: 'cancel_schedule' }
//         { action: 'process_sends' }       sends the emails that are waiting (the first ones leave while publishing; the rest wait their turn)
//         { action: 'resend', sendId }      one email again, to one applicant
// Nothing reaches an applicant before 'publish' (or a schedule whose time has come). A failed email never stops a result from showing in the app.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { RESULTS_NOT_READY, resultsReady } from '@/lib/calls/results-store';
import { cancelSchedule, loadPublication, processSends, publishNow, resendOne, runDueBatches, schedule, sendTestEmails } from '@/lib/calls/results-publish';

export const dynamic = 'force-dynamic';
// Publishing builds and queues every message and sends the first emails: give it room.
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'publish_results' });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  // What was scheduled and whose time has come goes out now (the daily job may be hours away).
  await runDueBatches(auth.admin).catch((e) => console.error('[results] due batches failed:', (e as Error).message));
  return NextResponse.json(await loadPublication(auth.admin, auth.call));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'publish_results' });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  const body = await req.json().catch(() => ({})) as { action?: string; confirmName?: unknown; at?: unknown; sendId?: unknown };
  const fail = (r: { status: number; error: string }) => NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  const fresh = async (extra: Record<string, unknown> = {}) => {
    const call = (await authCall(params.id, { need: 'publish_results' }));
    return NextResponse.json({ ...(call.error ? {} : await loadPublication(call.admin, call.call)), ...extra });
  };

  switch (body.action) {
    case 'test': {
      const r = await sendTestEmails(auth.admin, auth.call, auth.userId);
      return r.ok ? NextResponse.json({ ok: true, sent: r.sent, to: r.to }) : fail(r);
    }
    case 'publish': {
      const r = await publishNow(auth.admin, auth.call, auth.userId, body.confirmName);
      return r.ok ? fresh({ published: r.published }) : fail(r);
    }
    case 'schedule': {
      const r = await schedule(auth.admin, auth.call, auth.userId, body.at, body.confirmName);
      return r.ok ? fresh({ scheduledAt: r.scheduledAt }) : fail(r);
    }
    case 'cancel_schedule': {
      const r = await cancelSchedule(auth.admin, auth.call, auth.userId);
      return r.ok ? fresh() : fail(r);
    }
    case 'process_sends': {
      const run = await processSends(auth.admin, { callId: auth.call.id, budgetMs: 45_000 });
      return fresh({ run });
    }
    case 'resend': {
      if (typeof body.sendId !== 'string') return NextResponse.json({ ok: false, error: 'Choose an email.' }, { status: 400 });
      const r = await resendOne(auth.admin, auth.call, body.sendId, auth.userId);
      return r.ok ? fresh({ status: r.status }) : fail(r);
    }
    default:
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }
}
