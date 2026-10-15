// Prompt 905 — the life of a call (spec §8): confirm, edit configuration, publish, extend the deadline, close early.
// Each is a pure transition in src/lib/calls/lifecycle.ts; this route applies the patch with a compare-and-swap
// on the status the caller saw (two clicks cannot both succeed), records the event, and returns the new state.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { notifyDeadlineExtended } from '@/lib/calls/applicant/notices';
import { archiveCall, closeEarly, confirmCall, deleteProblem, editConfiguration, extendDeadline, publishCall, readiness, type Transition } from '@/lib/calls/lifecycle';
import { countApplications, deleteCallIfEmpty, generateLinkToken, loadFields, loadPhases, logCallEvent, snapshotConfig, transitionCall } from '@/lib/calls/store';
import { buildCallState, syncStatus } from '@/lib/calls/state';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as { action?: string; closesAt?: string };
  const now = new Date();
  // Look at the call as it is NOW (a scheduled call may have opened since the editor loaded).
  const call = await syncStatus(auth.admin, auth.call, now);

  // Delete (Prompt 909): the call and everything of it go, a record of who/what/when stays. Not a state change.
  if (body.action === 'delete') {
    const apps = await countApplications(auth.admin, call.id);
    const problem = deleteProblem(call.status, apps.total);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 409 });
    const res = await deleteCallIfEmpty(auth.admin, call, auth.userId, auth.promoter.name);
    if (!res.ok) {
      const error = res.reason === 'not_found' ? 'This call no longer exists.'
        : res.reason === 'has_applications' ? deleteProblem('draft', 1)!
        : res.reason === 'status' ? deleteProblem('open', 0)! : 'The call could not be deleted. Please try again.';
      return NextResponse.json({ ok: false, error }, { status: 409 });
    }
    return NextResponse.json({ ok: true, deleted: true, name: call.name });
  }

  let transition: Transition;
  switch (body.action) {
    case 'confirm': {
      const [phases, fields] = await Promise.all([loadPhases(auth.admin, call.id), loadFields(auth.admin, call.id)]);
      transition = confirmCall(call, readiness(call, phases, fields, now), auth.userId, now);
      break;
    }
    case 'edit': transition = editConfiguration(call); break;
    case 'publish': transition = publishCall(call, generateLinkToken(), now); break;
    case 'extend': transition = extendDeadline(call, String(body.closesAt ?? ''), now); break;
    case 'close': transition = closeEarly(call, now); break;
    case 'archive': transition = archiveCall(call, auth.userId, now); break;
    default: return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }
  if (!transition.ok) return NextResponse.json({ ok: false, error: transition.error }, { status: 409 });

  const updated = await transitionCall(auth.admin, call, transition.patch);
  if (!updated) return NextResponse.json({ ok: false, code: 'conflict', error: 'The call changed in the meantime. Reload and try again.' }, { status: 409 });

  if (body.action === 'confirm') {
    const [phases, fields] = await Promise.all([loadPhases(auth.admin, updated.id), loadFields(auth.admin, updated.id)]);
    await snapshotConfig(auth.admin, updated, phases, fields, auth.userId);
  }
  await logCallEvent(auth.admin, updated.id, transition.event, auth.userId, transition.detail ?? {});
  // Prompt 907 (I5): an extension notifies, by email and in-app, whoever has a draft not yet submitted — without the entity knowing who.
  if (body.action === 'extend') {
    const notified = await notifyDeadlineExtended(auth.admin, updated).catch((e) => { console.error('[calls] deadline notices failed:', (e as Error).message); return 0; });
    if (notified > 0) await logCallEvent(auth.admin, updated.id, 'deadline_extension_notified', null, { applicants: notified });
  }
  return NextResponse.json(await buildCallState(auth.admin, updated, auth.promoter, now));
}
