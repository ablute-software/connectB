// Prompt 905 — Calls: the list of the caller's calls (GET) and creating a new one (POST). 404 only when
// CALLS_MODE is explicitly "off" (Prompt 908: the emergency brake); only members of the promoting entity see
// anything; only its owners/admins create.
import { NextResponse, type NextRequest } from 'next/server';
import { authCalls, configurableCallIds, pickPromoter } from '@/lib/calls/access';
import { createCall, listDeletedCalls, listPromoterCalls, loadCall } from '@/lib/calls/store';
import { daysLeft } from '@/lib/calls/deletion';
import { bootstrapTeam } from '@/lib/calls/team-store';
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
    return { ...call, effectiveStatus: effectiveStatus(call, now), applications: c.applications, applicationsTotal: c.applicationsTotal, fields: c.fields, phases: c.phases, importRun: c.importRun };
  }));
  // Per call: may this person configure it (the menu offers Duplicate, Archive and Delete only then)?
  const configurable = await configurableCallIds(auth.admin, promoter, auth.userId, calls);
  // Prompt 918 (Adenda 2, C): the deleted calls, apart — each with the days left to restore it and whether this person may.
  const deleted = await listDeletedCalls(auth.admin, promoter.kind, promoter.id);
  const canRestore = await configurableCallIds(auth.admin, promoter, auth.userId, deleted);
  return NextResponse.json({
    ok: true, promoter: { kind: promoter.kind, id: promoter.id, name: promoter.name, canManage: promoter.canManage },
    calls: calls.map((c) => ({ ...c, canConfigure: configurable.has(c.id) })),
    deleted: deleted.map((c) => ({ id: c.id, name: c.name, deletedAt: c.deletedAt ?? null, purgeAfter: c.purgeAfter ?? null, daysLeft: daysLeft(c.purgeAfter, now), canRestore: canRestore.has(c.id), createdAt: c.createdAt, timezone: c.timezone })),
  });
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
  // The organisation's first category ("Administrator", with every permission) if it has none, and the creator in it.
  await bootstrapTeam(auth.admin, call, auth.userId);
  return NextResponse.json({ ok: true, call });
}
