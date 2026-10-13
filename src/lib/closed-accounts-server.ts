// Prompt 900 §A — the data behind Startups › "Closed & deleted": every org with closed_at set OR moderation_status = 'deleted', the
// people still attached to it (e-mail, role, e-mail confirmed, and every OTHER hat each one holds), how it ended and who did it,
// and — per person and per account — whether Release email / Reopen account is available, with the reason when it is not.
//
// Back-office only (the route behind it is requirePlatformAdmin) and read-only. The writes are the two SQL functions
// (moderation_reopen_org, moderation_release_org_member), called by their own routes.
//
// "In a GDPR erasure" has no org-level record in this schema (gdpr_requests is per person; erase_gdpr_person erases the contacts
// a founder holds, never an org). It is read the same way the SQL functions read it: a request of kind 'erase' that is pending,
// or resolved as erased, naming one of the account's members by user id or by e-mail.
import type { SupabaseClient } from '@supabase/supabase-js';
import { authFacts, UNKNOWN_EMAIL } from './backoffice-customer-people';
import { daysUntilPurge } from './account-security';
import {
  closureWays, ownerReopenable, releaseAvailability, reopenAvailability, signInHint,
  type ClosedAccount, type ClosedAccountMember, type EcosystemHat, type GdprState, type InvestorHat,
  type MemberHats, type OrgLifeFacts, type OrgModerationStatus, type TrailEntry,
} from './closed-accounts';

interface OrgRow {
  id: string; name: string; is_test: boolean | null; is_internal: boolean | null; created_at: string | null;
  moderation_status: OrgModerationStatus | null; closed_at: string | null; closed_by: string | null; closed_reason: string | null; purge_after: string | null;
}
interface ModerationRow { target_id: string; action: string; justification: string; actor: string; created_at: string }
interface AuditRow { admin_user_id: string | null; action: string; subject_id: string; detail: Record<string, unknown> | null; created_at: string }

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, manager: 2, member: 3 };
const rank = (role: string | null) => (role != null && role in ROLE_RANK ? ROLE_RANK[role] : 9);

/** The audit actions that tell the story of a dead account (the SQL functions write the first two; Prompt 602 the last two). */
export const TRAIL_ACTIONS = ['org_member_released', 'org_moderation_reopened', 'org_reopened', 'org_closed_by_owner'] as const;
const TRAIL_LIMIT = 6;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function trailText(a: AuditRow): string {
  const d = a.detail ?? {};
  switch (a.action) {
    case 'org_member_released':
      return `Released ${str(d.email) ?? 'a member'}${str(d.role) ? ` (${str(d.role)})` : ''}${str(d.reason) ? ` — “${str(d.reason)}”` : ''}${d.closedByThisRelease === true ? ' · it was the last member, so the account was closed' : ''}`;
    case 'org_moderation_reopened':
      return `Reopened (was deleted)${str(d.reason) ? ` — “${str(d.reason)}”` : ''}`;
    case 'org_reopened':
      return `Reopened inside its retention window${str(d.reason) ? ` — “${str(d.reason)}”` : ''}`;
    case 'org_closed_by_owner':
      return `Closed by its owner${str(d.ownerEmail) ? ` ${str(d.ownerEmail)}` : ''}`;
    default:
      return a.action;
  }
}

export async function loadClosedAccounts(admin: SupabaseClient, now: Date = new Date()): Promise<ClosedAccount[]> {
  const { data: orgRows, error } = await admin.from('orgs')
    .select('id, name, is_test, is_internal, created_at, moderation_status, closed_at, closed_by, closed_reason, purge_after')
    .or('closed_at.not.is.null,moderation_status.eq.deleted');
  if (error) throw new Error(error.message);
  const orgs = (orgRows ?? []) as OrgRow[];
  if (orgs.length === 0) return [];
  const orgIds = orgs.map((o) => o.id);

  const { data: memberRows } = await admin.from('org_members').select('org_id, user_id, role').in('org_id', orgIds);
  const members = (memberRows ?? []) as { org_id: string; user_id: string; role: string | null }[];
  const userIds = [...new Set(members.map((m) => m.user_id))];

  const [ecoRes, seatRes, blockedRes, gdprRes, modRes, auditRes] = await Promise.all([
    userIds.length ? admin.from('incubator_members').select('user_id, role, status, incubator_id').in('user_id', userIds).in('status', ['active', 'invited']) : Promise.resolve({ data: [] }),
    userIds.length ? admin.from('matchdeal_investor_members').select('user_id, role, status, catalog_entity_id').in('user_id', userIds).eq('status', 'active') : Promise.resolve({ data: [] }),
    admin.from('blocked_emails').select('email'),
    admin.from('gdpr_requests').select('claimant_email, claimant_user_id, status, resolution_method').eq('kind', 'erase'),
    admin.from('account_moderation_actions').select('target_id, action, justification, actor, created_at').eq('target_type', 'org').in('target_id', orgIds).order('created_at', { ascending: false }),
    admin.from('admin_audit_log').select('admin_user_id, action, subject_id, detail, created_at').in('subject_id', orgIds).in('action', [...TRAIL_ACTIONS]).order('created_at', { ascending: false }),
  ]);
  const eco = (ecoRes.data ?? []) as { user_id: string; role: string | null; status: string; incubator_id: string }[];
  const seats = (seatRes.data ?? []) as { user_id: string; role: string | null; status: string; catalog_entity_id: string }[];
  const modRows = (modRes.data ?? []) as ModerationRow[];
  const auditRows = (auditRes.data ?? []) as AuditRow[];

  const incubatorIds = [...new Set(eco.map((e) => e.incubator_id))];
  const entityIds = [...new Set(seats.map((s) => s.catalog_entity_id))];
  const [incRes, entRes] = await Promise.all([
    incubatorIds.length ? admin.from('incubators').select('id, name, closed_at').in('id', incubatorIds) : Promise.resolve({ data: [] }),
    entityIds.length ? admin.from('catalog_entities').select('id, name, moderation_status, moderation_suspended_until').in('id', entityIds) : Promise.resolve({ data: [] }),
  ]);
  const incubators = new Map(((incRes.data ?? []) as { id: string; name: string; closed_at: string | null }[]).map((i) => [i.id, i]));
  const entities = new Map(((entRes.data ?? []) as { id: string; name: string; moderation_status: string | null; moderation_suspended_until: string | null }[]).map((e) => [e.id, e]));

  // Everybody whose e-mail the screen shows: the members, and the admins / owners behind each event.
  const actorIds = new Set<string>();
  for (const o of orgs) if (o.closed_by) actorIds.add(o.closed_by);
  for (const m of modRows) actorIds.add(m.actor);
  for (const a of auditRows) if (a.admin_user_id) actorIds.add(a.admin_user_id);
  const wanted = [...new Set([...userIds, ...actorIds])];
  const factList = await Promise.all(wanted.map((id) => authFacts(admin, id)));
  const facts = new Map(wanted.map((id, i) => [id, factList[i]]));
  const emailOf = (id: string | null): string | null => {
    if (!id) return null;
    const e = facts.get(id)?.email;
    return e && e !== UNKNOWN_EMAIL ? e : null;
  };

  // Blocked list and GDPR erasures, by user id and by e-mail.
  const blocked = new Set(((blockedRes.data ?? []) as { email: string }[]).map((b) => b.email.trim().toLowerCase()));
  const gdprByUser = new Map<string, GdprState>();
  const gdprByEmail = new Map<string, GdprState>();
  const stronger = (a: GdprState | undefined, b: GdprState): GdprState => (a === 'pending' || b === 'pending' ? 'pending' : 'done');
  for (const g of (gdprRes.data ?? []) as { claimant_email: string | null; claimant_user_id: string | null; status: string; resolution_method: string | null }[]) {
    const state: GdprState | null = g.status === 'pending' ? 'pending' : g.status === 'resolved' && g.resolution_method === 'erased' ? 'done' : null;
    if (!state) continue;
    if (g.claimant_user_id) gdprByUser.set(g.claimant_user_id, stronger(gdprByUser.get(g.claimant_user_id), state));
    if (g.claimant_email) { const k = g.claimant_email.trim().toLowerCase(); gdprByEmail.set(k, stronger(gdprByEmail.get(k), state)); }
  }

  // Each person's other hats.
  const hatsByUser = new Map<string, MemberHats>();
  const hatsOf = (userId: string): MemberHats => {
    let h = hatsByUser.get(userId);
    if (!h) { h = { ecosystem: [], investor: [] }; hatsByUser.set(userId, h); }
    return h;
  };
  for (const e of eco) {
    const inc = incubators.get(e.incubator_id);
    const hat: EcosystemHat = { name: inc?.name ?? 'an ecosystem organisation', role: e.role ?? null, status: e.status, live: e.status === 'active' && !!inc && !inc.closed_at };
    hatsOf(e.user_id).ecosystem.push(hat);
  }
  for (const s of seats) {
    const ent = entities.get(s.catalog_entity_id);
    const suspended = ent?.moderation_status === 'suspended' && (!ent.moderation_suspended_until || new Date(ent.moderation_suspended_until).getTime() > now.getTime());
    const hat: InvestorHat = { name: ent?.name ?? 'an investor firm', role: s.role ?? null, live: !!ent && ent.moderation_status !== 'deleted' && !suspended };
    hatsOf(s.user_id).investor.push(hat);
  }

  const accounts: ClosedAccount[] = orgs.map((o): ClosedAccount => {
    const life: OrgLifeFacts = { moderationStatus: o.moderation_status ?? 'active', closedAt: o.closed_at, closedReason: o.closed_reason, purgeAfter: o.purge_after };
    const del = modRows.find((m) => m.target_id === o.id && m.action === 'delete') ?? null;

    const mine = members.filter((m) => m.org_id === o.id);
    const base = mine.map((m) => {
      const f = facts.get(m.user_id);
      const email = f?.email ?? UNKNOWN_EMAIL;
      return {
        userId: m.user_id, email, role: m.role ?? null, emailConfirmed: !!f?.emailConfirmed,
        hats: hatsByUser.get(m.user_id) ?? { ecosystem: [], investor: [] } as MemberHats,
        blocked: blocked.has(email.trim().toLowerCase()),
        gdpr: gdprByUser.get(m.user_id) ?? gdprByEmail.get(email.trim().toLowerCase()) ?? null,
      };
    });
    // An erasure of ONE member holds the whole account (the SQL reads it the same way); a blocked e-mail blocks Reopen for the account
    // but only Release for the person it belongs to.
    const orgGdpr = base.reduce<GdprState | null>((acc, p) => (p.gdpr ? stronger(acc ?? undefined, p.gdpr) : acc), null);
    const anyBlocked = base.some((p) => p.blocked);
    const people: ClosedAccountMember[] = base.map((p): ClosedAccountMember => ({
      ...p,
      signIn: signInHint(life, { blocked: p.blocked, hats: p.hats }),
      release: releaseAvailability(life, { gdpr: orgGdpr, memberBlocked: p.blocked }, now),
    })).sort((a, b) => rank(a.role) - rank(b.role) || a.email.localeCompare(b.email));

    const trail: TrailEntry[] = [
      ...modRows.filter((m) => m.target_id === o.id).map((m): TrailEntry => ({
        at: m.created_at, action: m.action, by: emailOf(m.actor),
        text: `${m.action === 'delete' ? 'Deleted by moderation' : m.action === 'suspend' ? 'Suspended' : m.action === 'undo' ? 'Suspension undone' : m.action === 'reopen' ? 'Reopened' : m.action}${m.justification ? ` — “${m.justification}”` : ''}`,
      })),
      ...auditRows.filter((a) => a.subject_id === o.id).map((a): TrailEntry => ({
        at: a.created_at, action: a.action, by: a.action === 'org_closed_by_owner' ? str((a.detail ?? {}).ownerEmail) : emailOf(a.admin_user_id), text: trailText(a),
      })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, TRAIL_LIMIT);

    const lastRelease = auditRows.find((a) => a.subject_id === o.id && a.action === 'org_member_released' && (a.detail ?? {}).closedByThisRelease === true) ?? null;
    return {
      orgId: o.id, name: o.name, isTest: !!o.is_test, isInternal: !!o.is_internal, createdAt: o.created_at,
      moderationStatus: life.moderationStatus, closedAt: o.closed_at, closedReason: o.closed_reason, purgeAfter: o.purge_after,
      ways: closureWays(life),
      deleted: life.moderationStatus === 'deleted' ? { at: del?.created_at ?? null, by: emailOf(del?.actor ?? null), reason: del?.justification || null } : null,
      closed: o.closed_at ? { at: o.closed_at, by: emailOf(o.closed_by), reason: o.closed_reason === 'last_member_deleted' ? str((lastRelease?.detail ?? {}).reason) : null } : null,
      when: [o.closed_at, life.moderationStatus === 'deleted' ? del?.created_at : null].filter((x): x is string => !!x).sort().at(-1) ?? null,
      gdprErasure: orgGdpr,
      members: people,
      reopen: reopenAvailability(life, { gdpr: orgGdpr, anyMemberBlocked: anyBlocked }, now),
      ownerReopenable: ownerReopenable(life, now),
      daysToPurge: o.purge_after ? daysUntilPurge(o.purge_after, now) : null,
      trail,
    };
  });

  // Most recently ended first; the name breaks ties so the order is stable.
  return accounts.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? '') || a.name.localeCompare(b.name));
}
