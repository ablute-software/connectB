// Prompt 905 — Calls: the list of the caller's calls (GET) and creating a new one (POST). Behind CALLS_MODE
// (404 when off); only members of the promoting entity see anything; only its owners/admins create.
import { NextResponse, type NextRequest } from 'next/server';
import { authCalls, pickPromoter } from '@/lib/calls/access';
import { createCall, listPromoterCalls, loadCall } from '@/lib/calls/store';
import { effectiveStatus } from '@/lib/calls/lifecycle';
import { syncStatus } from '@/lib/calls/state';

export async function GET(req: NextRequest) {
  const auth = await authCalls();
  if (auth.error) return auth.error;
  const promoter = pickPromoter(auth.promoters, req.nextUrl.searchParams.get('kind'));
  if (!promoter) return NextResponse.json({ ok: false, error: 'Choose which organisation you act for.' }, { status: 400 });

  // Bring statuses up to date before listing (a scheduled call may have opened since the last visit).
  const cards = await listPromoterCalls(auth.admin, promoter.kind, promoter.id);
  const now = new Date();
  const calls = await Promise.all(cards.map(async (c) => {
    const call = effectiveStatus(c.call, now) !== c.call.status ? await syncStatus(auth.admin, c.call, now) : c.call;
    return { ...call, effectiveStatus: effectiveStatus(call, now), applications: c.applications, fields: c.fields, phases: c.phases };
  }));
  return NextResponse.json({ ok: true, promoter: { kind: promoter.kind, id: promoter.id, name: promoter.name, canManage: promoter.canManage }, calls });
}

export async function POST(req: NextRequest) {
  const auth = await authCalls();
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as { kind?: string; name?: string };
  const promoter = pickPromoter(auth.promoters, body.kind);
  if (!promoter) return NextResponse.json({ ok: false, error: 'Choose which organisation you act for.' }, { status: 400 });
  if (!promoter.canManage) {
    return NextResponse.json({ ok: false, error: 'Only the owners and administrators of your organisation can create a call.' }, { status: 403 });
  }
  const name = (typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '') || 'Untitled call';
  const created = await createCall(auth.admin, { kind: promoter.kind, promoterId: promoter.id, userId: auth.userId, name });
  const call = (await loadCall(auth.admin, created.id)) ?? created;
  return NextResponse.json({ ok: true, call });
}
