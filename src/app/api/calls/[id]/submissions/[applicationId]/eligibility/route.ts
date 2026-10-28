// Prompt 918 (I3) — what a person does with the automatic eligibility result of ONE application (spec §7.6):
//
//   { action: 'correct_rule', ruleId, outcome: 'pass'|'fail', justification, callException? }   needs "Correct eligibility & document validity"
//   { action: 'reclassify',   status: 'fit'|'not_fit',          justification, callException? }   needs the same permission
//   { action: 'flag',         reason }                                                          whoever may "View all applications" (it only sends the application to To validate)
//   { action: 'retry' }                                                                         needs the correction permission: queues the evaluation again after a technical failure
//
// A correction always has a reason, recomputes the rest of the rules (the application does not become a Fit while another rule fails) and is kept as an example of how the engine did.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { correctRule, flagApplication, reclassify } from '@/lib/calls/eligibility-review';
import { logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';
type Row = Record<string, unknown>;

export async function POST(req: Request, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await authCall(params.id, { need: 'view_applications' });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const { data: app } = await auth.admin.from('call_applications').select('id, status').eq('id', params.applicationId).eq('call_id', auth.call.id).eq('status', 'submitted').maybeSingle();
  if (!app) return NextResponse.json({ ok: false }, { status: 404 });

  if (action === 'flag') {
    const r = await flagApplication(auth.admin, auth.call, params.applicationId, { reason: String(body.reason ?? ''), actor: auth.userId });
    if (!r.ok) return NextResponse.json({ ok: false, code: r.code, error: r.error }, { status: r.code === 'not_ready' ? 409 : 400 });
    await logCallEvent(auth.admin, auth.call.id, 'eligibility_flagged', auth.userId, { application: params.applicationId });
    return NextResponse.json({ ok: true, status: r.status, reason: r.reason });
  }
  if (!auth.perms.correct_eligibility) return NextResponse.json({ ok: false, error: 'You do not have the “Correct eligibility & document validity” permission on this call.' }, { status: 403 });

  if (action === 'retry') {
    const { data: task } = await auth.admin.from('call_processing_tasks').select('id, status').eq('application_id', params.applicationId).eq('status', 'technical_failure');
    const ids = ((task ?? []) as Row[]).map((t) => t.id as string);
    if (ids.length === 0) return NextResponse.json({ ok: false, error: 'There is nothing to retry for this application.' }, { status: 409 });
    await auth.admin.from('call_processing_tasks').update({ status: 'queued', attempts: 0, last_error: null, run_after: new Date().toISOString(), locked_at: null, finished_at: null }).in('id', ids);
    await logCallEvent(auth.admin, auth.call.id, 'eligibility_retry', auth.userId, { application: params.applicationId });
    return NextResponse.json({ ok: true, queued: ids.length });
  }
  const callException = body.callException === true;
  const justification = String(body.justification ?? '');
  const r = action === 'correct_rule'
    ? (body.outcome === 'pass' || body.outcome === 'fail'
      ? await correctRule(auth.admin, auth.call, params.applicationId, { ruleId: String(body.ruleId ?? ''), outcome: body.outcome, justification, actor: auth.userId, callException })
      : { ok: false as const, code: 'bad_request' as const, error: 'Choose pass or fail.' })
    : action === 'reclassify'
      ? (body.status === 'fit' || body.status === 'not_fit'
        ? await reclassify(auth.admin, auth.call, params.applicationId, { status: body.status, justification, actor: auth.userId, callException })
        : { ok: false as const, code: 'bad_request' as const, error: 'Choose Fit or Not a fit.' })
      : { ok: false as const, code: 'bad_request' as const, error: 'Unknown action.' };
  if (!r.ok) return NextResponse.json({ ok: false, code: r.code, error: r.error }, { status: r.code === 'not_ready' ? 409 : r.code === 'unknown_rule' ? 404 : 400 });
  await logCallEvent(auth.admin, auth.call.id, 'eligibility_corrected', auth.userId, { application: params.applicationId, action, status: r.status });
  return NextResponse.json({ ok: true, status: r.status, reason: r.reason });
}
