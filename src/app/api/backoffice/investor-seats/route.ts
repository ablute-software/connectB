// Prompt 904 Part C — back-office: the seats of each firm (C6) and the two ways to activate a custom
// plan (C3): pre-assignment (set_plan, before any claim) and entity-bound codes (create_code).
//   GET  ?q=text            search catalog entities to pick a firm
//   GET  ?entityId=<uuid>   one firm: plan, who holds each seat since when, free seats, reserved seats,
//                           codes, and the history
//   GET                     every firm that has a custom plan
//   POST { action, entityId, ... }  set_plan | end_plan | release | reassign | promote | invite |
//                           cancel_invite | create_code | revoke_code
// Platform admin only, checked here and not only by the middleware.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { makeSeatStore, seatPlansAvailable } from '@/lib/investor-firm-seats-store';
import {
  cancelSeatInvite, createSeatCode, endSeatPlan, inviteToSeat, promoteToAdmin, reassignSeat, removeSeat,
  revokeSeatCode, seatSummary, setSeatPlan, tierSeatLimitInfo,
} from '@/lib/investor-firm-seats';
import { resolveFirmPlanTier } from '@/lib/investor-seats';
import { INVESTOR_PLANS } from '@/lib/plans';

const MIGRATION_PENDING = 'Custom seat plans are not available yet: the database migration has not been applied.';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  if (!(await seatPlansAvailable(admin))) return NextResponse.json({ ok: false, error: MIGRATION_PENDING, migrationPending: true }, { status: 200 });

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();
  const entityId = url.searchParams.get('entityId');

  if (q) {
    const { data } = await admin.from('catalog_entities').select('id, name, website, is_test')
      .ilike('name', `%${q.replace(/[%_]/g, ' ')}%`).order('name').limit(15);
    return NextResponse.json({ ok: true, results: data ?? [] });
  }

  const store = makeSeatStore(admin);
  if (entityId) {
    const [{ data: entity }, tier] = await Promise.all([
      admin.from('catalog_entities').select('id, name, is_test').eq('id', entityId).maybeSingle(),
      resolveFirmPlanTier(admin, entityId),
    ]);
    if (!entity) return NextResponse.json({ ok: false, error: 'Firm not found.' }, { status: 404 });
    const fallback = tierSeatLimitInfo(tier, INVESTOR_PLANS.find((p) => p.tier === tier)?.name ?? 'Pro Scout');
    const [summary, codes, events] = await Promise.all([seatSummary(store, entityId, fallback), store.listCodes(entityId), store.events(entityId, 100)]);
    return NextResponse.json({ ok: true, entity, ...summary, codes, events });
  }

  const { data: plans } = await admin.from('investor_firm_seat_plans')
    .select('catalog_entity_id, plan_name, seats, tier, admin_email, activated_via, updated_at').eq('status', 'active').order('updated_at', { ascending: false });
  const ids = (plans ?? []).map((p) => p.catalog_entity_id as string);
  const { data: entities } = ids.length ? await admin.from('catalog_entities').select('id, name').in('id', ids) : { data: [] };
  const nameBy = new Map((entities ?? []).map((e) => [e.id as string, e.name as string]));
  const rows = await Promise.all((plans ?? []).map(async (p) => {
    const id = p.catalog_entity_id as string;
    const [members, invites] = await Promise.all([store.activeMemberUserIds(id), store.openInvites(id)]);
    return {
      entityId: id, name: nameBy.get(id) ?? 'Unknown', planName: p.plan_name, seats: p.seats, tier: p.tier,
      adminEmail: p.admin_email, activatedVia: p.activated_via, used: members.length, reserved: invites.length,
      free: Math.max(0, (p.seats as number) - members.length - invites.length),
    };
  }));
  return NextResponse.json({ ok: true, firms: rows });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await seatPlansAvailable(admin))) return NextResponse.json({ ok: false, error: MIGRATION_PENDING, migrationPending: true }, { status: 200 });

  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(b.action ?? '');
  const entityId = typeof b.entityId === 'string' ? b.entityId : '';
  if (!entityId) return NextResponse.json({ ok: false, error: 'Missing entityId.' }, { status: 400 });
  const { data: entity } = await admin.from('catalog_entities').select('id, name').eq('id', entityId).maybeSingle();
  if (!entity) return NextResponse.json({ ok: false, error: 'Firm not found.' }, { status: 404 });

  const store = makeSeatStore(admin);
  let result: { ok: boolean; status?: number; error?: string } & Record<string, unknown>;
  switch (action) {
    case 'set_plan':
      result = await setSeatPlan(store, {
        entityId, seats: Number(b.seats), tier: typeof b.tier === 'string' ? b.tier : undefined,
        planName: typeof b.planName === 'string' ? b.planName : undefined,
        adminEmail: b.adminEmail === undefined ? undefined : (typeof b.adminEmail === 'string' ? b.adminEmail : null),
        actor: userId, note: typeof b.note === 'string' ? b.note : null,
      });
      break;
    case 'end_plan': result = await endSeatPlan(store, { entityId, actor: userId }); break;
    case 'release':
      result = await removeSeat(store, { entityId, memberId: String(b.memberId ?? ''), actor: userId });
      break;
    case 'reassign':
      result = await reassignSeat(store, { entityId, memberId: String(b.memberId ?? ''), toEmail: String(b.toEmail ?? ''), actor: userId });
      break;
    case 'promote': result = await promoteToAdmin(store, { entityId, memberId: String(b.memberId ?? ''), actor: userId }); break;
    case 'invite': result = await inviteToSeat(store, { entityId, email: String(b.email ?? ''), actor: userId }); break;
    case 'cancel_invite': result = await cancelSeatInvite(store, { entityId, inviteId: String(b.inviteId ?? ''), actor: userId }); break;
    case 'create_code':
      result = await createSeatCode(store, {
        entityId, seats: Number(b.seats), validDays: b.validDays === undefined ? undefined : Number(b.validDays),
        actor: userId, note: typeof b.note === 'string' ? b.note : null,
      });
      break;
    case 'revoke_code': result = await revokeSeatCode(store, { entityId, codeId: String(b.codeId ?? ''), actor: userId }); break;
    default: return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 400 });
  // The plaintext code is returned ONCE, to this response; it is never logged.
  const { ok: _ok, status: _status, ...rest } = result;
  await logAdminAction(admin, {
    adminUserId: userId, action: `investor_seats_${action}`, subjectType: 'catalog_entity', subjectId: entityId,
    detail: { firm: entity.name, ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'code')) },
  });
  return NextResponse.json({ ok: true, ...rest });
}
