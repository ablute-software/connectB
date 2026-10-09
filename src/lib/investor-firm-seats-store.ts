// Prompt 904 Part C — the Supabase side of SeatStore (investor-firm-seats.ts). Service-role client,
// so every caller has already authenticated and authorised the request; nothing here decides who
// may do what. Reads are tolerant of the tables not existing yet (migration not applied): the
// plan lookup then answers "no custom plan", which leaves every firm on the 1/2/5 tiers exactly as
// before — the code can ship before the migration without changing anything.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FirmSeatPlan, SeatCodeRow, SeatEvent, SeatInvite, SeatMember, SeatStore,
} from './investor-firm-seats';

type Row = Record<string, unknown>;

/** True when the Part C tables exist (migration applied). */
export async function seatPlansAvailable(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('investor_firm_seat_plans').select('catalog_entity_id').limit(1);
  return !error;
}

function toPlan(r: Row): FirmSeatPlan {
  return {
    catalogEntityId: r.catalog_entity_id as string, planName: r.plan_name as string, seats: r.seats as number,
    tier: r.tier as string, adminEmail: (r.admin_email as string | null) ?? null,
  };
}

export function makeSeatStore(admin: SupabaseClient): SeatStore {
  const emailCache = new Map<string, string | null>();
  async function emailOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    if (emailCache.has(userId)) return emailCache.get(userId)!;
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email?.toLowerCase() ?? null;
    emailCache.set(userId, email);
    return email;
  }

  return {
    async getPlan(entityId) {
      const { data, error } = await admin.from('investor_firm_seat_plans').select('*')
        .eq('catalog_entity_id', entityId).eq('status', 'active').maybeSingle();
      if (error || !data) return null;
      return toPlan(data as Row);
    },

    async upsertPlan(plan) {
      const { error } = await admin.from('investor_firm_seat_plans').upsert({
        catalog_entity_id: plan.catalogEntityId, plan_name: plan.planName, seats: plan.seats, tier: plan.tier,
        status: 'active', activated_via: plan.activatedVia, admin_email: plan.adminEmail, note: plan.note ?? null,
        set_by: plan.setBy, updated_at: new Date().toISOString(),
      }, { onConflict: 'catalog_entity_id' });
      if (error) throw new Error(error.message);
    },

    async endPlan(entityId) {
      const { error } = await admin.from('investor_firm_seat_plans')
        .update({ status: 'ended', updated_at: new Date().toISOString() }).eq('catalog_entity_id', entityId);
      if (error) throw new Error(error.message);
    },

    async activeMembers(entityId) {
      const { data: rows } = await admin.from('matchdeal_investor_members').select('id, user_id, role, created_at')
        .eq('catalog_entity_id', entityId).eq('status', 'active').order('created_at', { ascending: true });
      const members = (rows ?? []) as Row[];
      if (!members.length) return [];
      const ids = members.map((m) => m.id as string);
      const [{ data: profiles }, { data: events }] = await Promise.all([
        admin.from('matchdeal_profiles').select('membership_id, representative_name').eq('kind', 'investor').in('membership_id', ids),
        admin.from('investor_seat_events').select('member_id, created_at').eq('event', 'seat_granted').in('member_id', ids).order('id', { ascending: false }),
      ]);
      const nameBy = new Map(((profiles ?? []) as Row[]).map((p) => [p.membership_id as string, (p.representative_name as string | null) ?? null]));
      const sinceBy = new Map<string, string>();
      for (const e of (events ?? []) as Row[]) if (!sinceBy.has(e.member_id as string)) sinceBy.set(e.member_id as string, e.created_at as string);
      return Promise.all(members.map(async (m): Promise<SeatMember> => ({
        id: m.id as string, userId: m.user_id as string, email: await emailOf(m.user_id as string),
        name: nameBy.get(m.id as string) ?? null, role: (m.role as string | null) ?? null,
        since: sinceBy.get(m.id as string) ?? (m.created_at as string | null) ?? null,
      })));
    },

    async activeMemberUserIds(entityId) {
      const { data } = await admin.from('matchdeal_investor_members').select('user_id')
        .eq('catalog_entity_id', entityId).eq('status', 'active');
      return ((data ?? []) as Row[]).map((r) => r.user_id as string);
    },

    async revokedUserIds(entityId) {
      const { data } = await admin.from('matchdeal_investor_members').select('user_id')
        .eq('catalog_entity_id', entityId).eq('status', 'revoked');
      return ((data ?? []) as Row[]).map((r) => r.user_id as string);
    },

    async openInvites(entityId) {
      const { data, error } = await admin.from('investor_firm_seat_invites').select('id, email, invited_by, created_at')
        .eq('catalog_entity_id', entityId).eq('status', 'open').order('created_at', { ascending: true });
      if (error) return [];
      return ((data ?? []) as Row[]).map((r): SeatInvite => ({
        id: r.id as string, email: r.email as string, invitedBy: (r.invited_by as string | null) ?? null, createdAt: r.created_at as string,
      }));
    },

    async addInvite(entityId, email, invitedBy) {
      const { error } = await admin.from('investor_firm_seat_invites').insert({ catalog_entity_id: entityId, email, invited_by: invitedBy });
      if (error) throw new Error(error.message);
    },

    async cancelInvite(entityId, inviteId) {
      const { data } = await admin.from('investor_firm_seat_invites').update({ status: 'cancelled' })
        .eq('id', inviteId).eq('catalog_entity_id', entityId).eq('status', 'open').select('id');
      return (data ?? []).length > 0;
    },

    async acceptInvite(entityId, email, userId) {
      await admin.from('investor_firm_seat_invites')
        .update({ status: 'accepted', accepted_user_id: userId, accepted_at: new Date().toISOString() })
        .eq('catalog_entity_id', entityId).eq('email', email).eq('status', 'open');
    },

    async revokeMember(entityId, memberId) {
      const { data } = await admin.from('matchdeal_investor_members').update({ status: 'revoked' })
        .eq('id', memberId).eq('catalog_entity_id', entityId).eq('status', 'active').select('id');
      return (data ?? []).length > 0;
    },

    async setMemberRole(entityId, memberId, role) {
      const { data } = await admin.from('matchdeal_investor_members').update({ role })
        .eq('id', memberId).eq('catalog_entity_id', entityId).select('id');
      return (data ?? []).length > 0;
    },

    async recordActor(entityId, memberId, actor, detail) {
      if (!memberId) return;
      const { data } = await admin.from('investor_seat_events').select('id, detail')
        .eq('catalog_entity_id', entityId).eq('member_id', memberId).order('id', { ascending: false }).limit(1);
      const last = (data ?? [])[0] as Row | undefined;
      if (!last) return;
      await admin.from('investor_seat_events')
        .update({ actor_user_id: actor, detail: { ...((last.detail as Row) ?? {}), ...(detail ?? {}) } }).eq('id', last.id as number);
    },

    async recordEvent(entityId, event, actor, detail) {
      await admin.from('investor_seat_events').insert({ catalog_entity_id: entityId, event, actor_user_id: actor, detail: detail ?? {} });
    },

    async events(entityId, limit) {
      const { data } = await admin.from('investor_seat_events').select('id, event, user_id, actor_user_id, detail, created_at')
        .eq('catalog_entity_id', entityId).order('id', { ascending: false }).limit(limit);
      return Promise.all(((data ?? []) as Row[]).map(async (e): Promise<SeatEvent> => ({
        id: e.id as number, event: e.event as string, userId: (e.user_id as string | null) ?? null,
        email: await emailOf((e.user_id as string | null) ?? null), actorUserId: (e.actor_user_id as string | null) ?? null,
        detail: (e.detail as Record<string, unknown>) ?? {}, createdAt: e.created_at as string,
      })));
    },

    async insertCode(row) {
      const { error } = await admin.from('investor_seat_codes').insert({
        code_hash: row.codeHash, code_hint: row.codeHint, catalog_entity_id: row.entityId, seats: row.seats, tier: row.tier,
        plan_name: row.planName, expires_at: row.expiresAt, created_by: row.createdBy, note: row.note,
      });
      if (error) throw new Error(error.message);
    },

    async listCodes(entityId) {
      const { data } = await admin.from('investor_seat_codes')
        .select('id, code_hint, seats, plan_name, status, expires_at, redeemed_by, redeemed_at, created_at, note')
        .eq('catalog_entity_id', entityId).order('created_at', { ascending: false });
      return ((data ?? []) as Row[]).map((c): SeatCodeRow => ({
        id: c.id as string, codeHint: c.code_hint as string, seats: c.seats as number, planName: c.plan_name as string,
        status: c.status as SeatCodeRow['status'], expiresAt: c.expires_at as string, redeemedBy: (c.redeemed_by as string | null) ?? null,
        redeemedAt: (c.redeemed_at as string | null) ?? null, createdAt: c.created_at as string, note: (c.note as string | null) ?? null,
      }));
    },

    async revokeCode(entityId, codeId) {
      const { data } = await admin.from('investor_seat_codes').update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', codeId).eq('catalog_entity_id', entityId).eq('status', 'active').select('id');
      return (data ?? []).length > 0;
    },

    async redeemCode(codeHash, userId) {
      const { data, error } = await admin.rpc('redeem_investor_seat_code', { p_code_hash: codeHash, p_user: userId });
      if (error || !data || data.ok !== true) return { ok: false };
      return { ok: true, catalogEntityId: data.catalog_entity_id as string, seats: Number(data.seats ?? 0) };
    },
  };
}
