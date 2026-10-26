// Prompt 918 (Adenda 2, C) — bring a deleted call back, within the 30 days, by whoever may "Configure call" on it. The call returns as it was — a call that was open comes back CLOSED (deleting
// closed it; reopening is a decision of its own: "Reopen and extend"). Its applications, drafts and files were never touched. After the 30 days it is gone for good and this answers 409.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { notifyCallRestored } from '@/lib/calls/applicant/notices';
import { logCallEvent, restoreCall } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true, includeDeleted: true });
  if (auth.error) return auth.error;
  if (!auth.call.deletedAt) return NextResponse.json({ ok: false, error: 'This call is not deleted.' }, { status: 409 });
  const res = await restoreCall(auth.admin, auth.call.id, auth.userId, auth.promoter.name);
  if (!res.ok) {
    const error = res.reason === 'expired' ? 'The 30 days to restore this call are over: it has been removed.' : res.reason === 'not_found' ? 'This call no longer exists.' : 'The call could not be restored. Please try again.';
    return NextResponse.json({ ok: false, error }, { status: res.reason === 'error' ? 500 : 409 });
  }
  await logCallEvent(auth.admin, auth.call.id, 'call_restored', auth.userId, { status: res.status });
  // The applicants who were told it was cancelled are told it is back (Prompt 918, Adenda 3); a failed email never undoes the restore.
  const notified = await notifyCallRestored(auth.admin, auth.call, auth.promoter.name, auth.call.deletedAt ?? null).catch((e) => { console.error('[calls] restore notices failed:', (e as Error).message); return 0; });
  if (notified > 0) await logCallEvent(auth.admin, auth.call.id, 'call_restored_notified', null, { applicants: notified });
  return NextResponse.json({ ok: true, restored: true, name: auth.call.name, status: res.status, notified });
}
