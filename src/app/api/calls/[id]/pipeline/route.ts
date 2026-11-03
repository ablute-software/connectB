// Prompt 927 (A) — "Add applicants to my pipeline": a call administrator (whoever may "Configure call") brings the applications submitted BEFORE the notice existed into THEIR OWN pipeline. Nothing is added to
// anyone else's, and it only exists for the calls of an investor firm (an incubator has no investor pipeline). GET says whether there is anything to add; POST adds.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { logCallEvent } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

async function pending(admin: Parameters<typeof logCallEvent>[0], callId: string, userId: string): Promise<{ older: number; done: boolean }> {
  const [{ data: apps }, { data: done }] = await Promise.all([
    admin.from('call_applications').select('id, startup_org_id, pipeline_notice_at').eq('call_id', callId).eq('status', 'submitted'),
    admin.from('call_pipeline_backfills').select('id').eq('call_id', callId).eq('user_id', userId).maybeSingle(),
  ]);
  const older = ((apps ?? []) as { startup_org_id: string | null; pipeline_notice_at: string | null }[]).filter((a) => a.startup_org_id && !a.pipeline_notice_at).length;
  return { older, done: !!done };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (auth.call.promoterKind !== 'catalog_entity') return NextResponse.json({ ok: true, available: false, older: 0, done: false });
  return NextResponse.json({ ok: true, available: true, ...(await pending(auth.admin, auth.call.id, auth.userId)) });
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (auth.call.promoterKind !== 'catalog_entity') return NextResponse.json({ ok: false, error: 'Only the calls of an investor firm have a pipeline to add applicants to.' }, { status: 400 });
  const before = await pending(auth.admin, auth.call.id, auth.userId);
  const { error } = await auth.admin.from('call_pipeline_backfills').upsert({ call_id: auth.call.id, user_id: auth.userId }, { onConflict: 'call_id,user_id' });
  if (error) return NextResponse.json({ ok: false, error: 'We could not add them. Please try again.' }, { status: 500 });
  if (!before.done) await logCallEvent(auth.admin, auth.call.id, 'pipeline_backfill', auth.userId, { applications: before.older });
  return NextResponse.json({ ok: true, available: true, added: before.done ? 0 : before.older, older: before.older, done: true });
}
