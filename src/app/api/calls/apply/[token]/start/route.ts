// Prompt 907 (I1/I2) — "open my application on this call": records that this startup reached the call by its link (so an unlisted call
// shows in its own list afterwards), then creates the application — or resumes it, pre-filled once from the platform's data — and returns
// everything the form is rendered from, plus the page it reopens on. The atomic work (the per-unit limit, one application for two
// simultaneous requests) is the SQL function call_open_application.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplicantByToken } from '@/lib/calls/applicant/auth';
import { buildApplicationState, openApplication, recordLinkAccess, resumePage } from '@/lib/calls/applicant/store';
import { phaseSentence } from '@/lib/calls/applicant/phase';
import { promoterName } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

export const POST = withActingOrg(async function POST(req: Request, { params }: { params: { token: string } }) {
  const a = await authApplicantByToken(req, params.token);
  if (a.error) return a.error;
  const body = (await req.json().catch(() => ({}))) as { new?: unknown };

  await recordLinkAccess(a.admin, a.call.id, a.orgId, a.userId);
  const r = await openApplication(a.admin, a.call, a.fields, a.orgId, a.userId, { startNew: body.new === true });
  if (!r.ok) {
    if (r.reason === 'not_accepting') {
      return NextResponse.json({ ok: false, code: 'closed', error: phaseSentence(a.call) ?? 'This call is not accepting applications.' }, { status: 409 });
    }
    if (r.reason === 'unit_limit') {
      return NextResponse.json({ ok: false, code: 'unit_limit', error: a.call.limitUnit === 'legal_entity'
        ? 'An application from your company already exists on this call, and only one per company is accepted.'
        : 'Your startup already has an application on this call, and only one per startup is accepted.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'We could not open your application. Please try again.' }, { status: 500 });
  }
  const state = await buildApplicationState(a.admin, a.call, a.fields, r.application, await promoterName(a.admin, a.call.promoterKind, a.call.promoterId));
  return NextResponse.json({ ok: true, created: r.created, state, page: resumePage(a.fields, state.answers, r.application.lastPage) });
});
