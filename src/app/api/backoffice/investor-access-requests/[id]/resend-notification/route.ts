// Item 10 — a failed approve/reject notification must be visibly
// recoverable, not a second silent dead end. Re-sends the exact email the
// current status implies (approved/rejected) and re-writes notified_at/
// notify_failed the same way approve/reject do.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { notifyInvestorAccessDecision } from '@/lib/investor-access-request-notify';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: reqRow, error: reqErr } = await admin.from('investor_access_requests')
    .select('id, email, status').eq('id', id).single();
  if (reqErr) return NextResponse.json({ ok: false, error: reqErr.message }, { status: 404 });
  if (reqRow.status !== 'approved' && reqRow.status !== 'rejected') {
    return NextResponse.json({ ok: false, error: 'Only an already-decided request can be re-notified.' }, { status: 400 });
  }

  const { notifyFailed } = await notifyInvestorAccessDecision(admin, {
    id, email: reqRow.email, status: reqRow.status as 'approved' | 'rejected',
  });
  return NextResponse.json({ ok: true, notifyFailed });
}
