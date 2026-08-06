import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { notifyInvestorAccessDecision } from '@/lib/investor-access-request-notify';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: reqRow, error: reqErr } = await admin.from('investor_access_requests')
    .select('id, email').eq('id', id).single();
  if (reqErr) return NextResponse.json({ ok: false, error: reqErr.message }, { status: 404 });

  const { error } = await admin.from('investor_access_requests').update({
    status: 'rejected', reviewed_by: userId, reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'investor_access_request_rejected', subjectType: 'investor_access_request', subjectId: id });

  // Item 10 — same posture as approve: the decision already committed above,
  // a failed notification never reverts it. /suspended (item 6) established
  // the convention of not exposing internal reasoning to the affected party
  // — this follows it: short, no justification, reply_to (item 12) makes it
  // actually usable if they want to ask why.
  const { notifyFailed } = await notifyInvestorAccessDecision(admin, { id, email: reqRow.email, status: 'rejected' });

  return NextResponse.json({ ok: true, notifyFailed });
}
