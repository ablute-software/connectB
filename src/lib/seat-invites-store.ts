// Prompt 923 (B) — the database side of seat invitations: the ports seat-invite-accept.ts decides with, and the email that carries the link. Service-role only (the routes check who is calling).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_URL, BRAND_NAME } from '@/lib/brand';
import { checkInvestorDomainMatch, isAutoEligible } from '@/lib/investor-domain-match';
import { checkSeatAvailable } from '@/lib/investor-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import type { InvitePorts, InviteRecord, InviteStatus } from '@/lib/seat-invite-accept';

type Row = Record<string, unknown>;

export const inviteLink = (token: string, base: string = APP_URL): string => `${/^https?:\/\//i.test(base) ? base : `https://${base}`}`.replace(/\/$/, '') + `/invite/seat/${token}`;

export async function loadInvite(admin: SupabaseClient, token: string): Promise<InviteRecord | null> {
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
  const { data } = await admin.from('investor_firm_seat_invites').select('id, catalog_entity_id, email, status, accepted_user_id, failure_reason').eq('token', token).maybeSingle();
  const r = data as Row | null;
  if (!r) return null;
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', r.catalog_entity_id as string).maybeSingle();
  return {
    id: r.id as string, entityId: r.catalog_entity_id as string, firmName: String((entity as Row | null)?.name ?? 'the firm'), email: String(r.email), status: r.status as InviteStatus,
    acceptedUserId: (r.accepted_user_id as string | null) ?? null, failureReason: (r.failure_reason as string | null) ?? null,
  };
}

export function makeInvitePorts(admin: SupabaseClient): InvitePorts {
  const seats = makeSeatStore(admin);
  return {
    invite: (token) => loadInvite(admin, token),

    async activeFirms(userId) {
      const { data } = await admin.from('matchdeal_investor_members').select('catalog_entity_id').eq('user_id', userId).eq('status', 'active');
      const ids = ((data ?? []) as Row[]).map((r) => r.catalog_entity_id as string);
      if (!ids.length) return [];
      const { data: entities } = await admin.from('catalog_entities').select('id, name').in('id', ids);
      const names = new Map(((entities ?? []) as Row[]).map((e) => [e.id as string, String(e.name ?? 'a firm')]));
      return ids.map((id) => ({ entityId: id, name: names.get(id) ?? 'a firm' }));
    },

    async seatRefusal(entityId, userId, email) {
      // The firm's own seat plan: invitations only exist on a firm with a custom plan, so a plan that has ended ends them too.
      const plan = await seats.getPlan(entityId);
      if (!plan) return 'This firm no longer has a seat plan. Ask the inviter to send you a new invitation.';
      const verdict = await checkSeatAvailable(admin, entityId, userId, email);
      return verdict.allowed ? null : (verdict.reason ?? 'This firm has no free seat right now. Ask the inviter.');
    },

    async join({ invite, userId, email, name, jobRole }) {
      const { data: entity } = await admin.from('catalog_entities').select('id, name, website').eq('id', invite.entityId).maybeSingle();
      const e = entity as Row | null;
      const domainVerified = e ? isAutoEligible(checkInvestorDomainMatch({ email, firmName: String(e.name), entities: [{ id: e.id as string, name: String(e.name), website: (e.website as string | null) ?? null }] })) : false;
      const { data: member, error } = await admin.from('matchdeal_investor_members')
        .upsert({ user_id: userId, catalog_entity_id: invite.entityId, status: 'active', domain_verified: domainVerified }, { onConflict: 'user_id,catalog_entity_id' }).select('id').single();
      if (error || !member) {
        // The seat limit is also enforced by a trigger in the database: say it in words, never the raw message.
        return { ok: false, error: /seat|limit/i.test(error?.message ?? '') ? 'This firm has no free seat right now. Ask the inviter.' : 'We could not add you to the firm just now. Try again in a minute, or ask the inviter.' };
      }
      const membershipId = (member as Row).id as string;
      if (name) {
        const { data: profile } = await admin.from('matchdeal_profiles').select('id, representative_name').eq('membership_id', membershipId).eq('kind', 'investor').maybeSingle();
        const p = profile as Row | null;
        if (!p) await admin.from('matchdeal_profiles').insert({ membership_id: membershipId, kind: 'investor', representative_name: name });
        else if (!p.representative_name) await admin.from('matchdeal_profiles').update({ representative_name: name }).eq('id', p.id as string);
      }
      if (name || jobRole) {
        try {
          const { data: u } = await admin.auth.admin.getUserById(userId);
          const meta = { ...((u?.user?.user_metadata ?? {}) as Record<string, unknown>) };
          if (name && !meta.full_name) meta.full_name = name;
          if (jobRole && !meta.job_title) meta.job_title = jobRole;
          meta.signup_intent = meta.signup_intent ?? 'investor_seat_invite';
          await admin.auth.admin.updateUserById(userId, { user_metadata: meta });
        } catch { /* the seat is what matters; the name is also in the profile */ }
      }
      const upd = await admin.from('investor_firm_seat_invites')
        .update({ status: 'accepted', accepted_user_id: userId, accepted_at: new Date().toISOString(), failure_reason: null, failed_at: null })
        .eq('id', invite.id).eq('status', 'open').select('id');
      if (upd.error) return { ok: false, error: 'We could not complete the invitation just now. Try again in a minute.' };
      return { ok: true };
    },

    async fail(invite, reason, userId) {
      await admin.from('investor_firm_seat_invites').update({ failure_reason: reason.slice(0, 500), failed_at: new Date().toISOString() }).eq('id', invite.id).eq('status', 'open');
      await seats.recordEvent(invite.entityId, 'invite_failed', userId, { inviteId: invite.id, reason: reason.slice(0, 200) });
    },

    async record(invite, event, userId) { await seats.recordEvent(invite.entityId, event, userId, { inviteId: invite.id }); },
  };
}

/** The email of an invitation: ONE button, to the invitation's own page. (It used to point to /login and tell the person to claim the profile, which opened the founder registration for a new person.) */
export async function sendSeatInviteEmail(admin: SupabaseClient, args: { entityId: string; email: string; token: string }): Promise<boolean> {
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', args.entityId).maybeSingle();
  const firm = ((entity as Row | null)?.name as string | undefined) ?? 'your firm';
  const sent = await sendTransactionalEmail({
    to: args.email.trim().toLowerCase(),
    subject: `${firm} invited you to join it on ${BRAND_NAME}`,
    html: transactionalTemplate({
      heading: `Join ${firm} on ${BRAND_NAME}`,
      body: `${firm} reserved a seat for you. Open the invitation, confirm this email address with a 6-digit code, tell us your name and your role, and you are in. There is nothing else to set up.`,
      ctaLabel: 'Open the invitation', ctaUrl: inviteLink(args.token),
      footer: 'If you were not expecting this, you can ignore this email.',
    }),
    text: `${firm} reserved a seat for you on ${BRAND_NAME}. Open the invitation: ${inviteLink(args.token)}`,
    context: { kind: 'other' },
  }).catch(() => ({ sent: false }));
  return !!sent.sent;
}
