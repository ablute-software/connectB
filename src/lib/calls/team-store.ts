// Prompt 909 (I3) — the Supabase side of the team of a call: the categories of the organisation, the people of each
// call, who in the organisation may be added, and the conflicts declared up front. Service role, so callers have
// already authenticated and authorised the request (access.ts); nothing here decides who may do what. What it does
// keep coherent: the first person of a call is an administrator (bootstrap), categories are unique by name per
// organisation, and a category that still has people is never removed.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ADMIN_CATEGORY_NAME, ALL_PERMISSIONS, isCallAdministrator, normalizeOverrides, normalizePermissions, sameCategoryName, type PermissionSet,
} from './permissions';
import type { TeamCategory, TeamMember } from './team-rules';
import type { Call, PromoterKind } from './types';

type Row = Record<string, unknown>;
export interface OrgRef { kind: PromoterKind; id: string }
const orgCol = (kind: PromoterKind) => (kind === 'incubator' ? 'incubator_id' : 'catalog_entity_id');
export const callOrg = (call: Pick<Call, 'promoterKind' | 'promoterId'>): OrgRef => ({ kind: call.promoterKind, id: call.promoterId });

const isDuplicate = (e: { code?: string } | null) => e?.code === '23505';

// --- Categories (the organisation's) -------------------------------------------------------------------------------

const toCategory = (r: Row): TeamCategory => ({ id: r.id as string, name: r.name as string, permissions: normalizePermissions(r.permissions) });

export async function loadCategories(admin: SupabaseClient, org: OrgRef): Promise<TeamCategory[]> {
  const { data } = await admin.from('call_team_categories').select('*').eq(orgCol(org.kind), org.id).order('created_at', { ascending: true });
  return ((data ?? []) as Row[]).map(toCategory);
}

/** People per category across ALL the calls of the organisation (what a category is "in use" by). */
export async function categoryUsage(admin: SupabaseClient, categoryIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!categoryIds.length) return out;
  const { data } = await admin.from('call_team_members').select('category_id').in('category_id', categoryIds);
  for (const r of (data ?? []) as Row[]) out.set(r.category_id as string, (out.get(r.category_id as string) ?? 0) + 1);
  return out;
}

export async function createCategory(
  admin: SupabaseClient, org: OrgRef, name: string, permissions: PermissionSet, actor: string,
): Promise<{ ok: true; category: TeamCategory } | { ok: false; error: string }> {
  const { data, error } = await admin.from('call_team_categories').insert({
    promoter_kind: org.kind, [orgCol(org.kind)]: org.id, name, permissions, created_by: actor,
  }).select('*').single();
  if (isDuplicate(error)) return { ok: false, error: `There is already a category called “${name}” in your organisation.` };
  if (error || !data) return { ok: false, error: 'Could not create the category.' };
  return { ok: true, category: toCategory(data as Row) };
}

export async function renameCategory(admin: SupabaseClient, id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from('call_team_categories').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
  if (isDuplicate(error)) return { ok: false, error: `There is already a category called “${name}” in your organisation.` };
  return error ? { ok: false, error: 'Could not rename the category.' } : { ok: true };
}

export async function updateCategoryPermissions(admin: SupabaseClient, id: string, permissions: PermissionSet): Promise<void> {
  await admin.from('call_team_categories').update({ permissions, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function deleteCategory(admin: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await admin.from('call_team_categories').delete().eq('id', id);
  return !error; // the database refuses it too while a person is still in it
}

// --- The people of a call ------------------------------------------------------------------------------------------

const toMember = (r: Row): TeamMember => ({ userId: r.user_id as string, categoryId: r.category_id as string, overrides: normalizeOverrides(r.permission_overrides) });

export async function loadCallTeam(admin: SupabaseClient, callId: string): Promise<TeamMember[]> {
  const { data } = await admin.from('call_team_members').select('*').eq('call_id', callId).order('created_at', { ascending: true });
  return ((data ?? []) as Row[]).map(toMember);
}

/** Every call that has somebody in this category, with its whole team: to check that changing the category leaves each one an administrator. */
export async function teamsUsingCategory(admin: SupabaseClient, categoryId: string): Promise<Map<string, TeamMember[]>> {
  const { data } = await admin.from('call_team_members').select('call_id').eq('category_id', categoryId);
  const out = new Map<string, TeamMember[]>();
  for (const id of new Set(((data ?? []) as Row[]).map((r) => r.call_id as string))) out.set(id, await loadCallTeam(admin, id));
  return out;
}

export async function insertMember(admin: SupabaseClient, callId: string, userId: string, categoryId: string, actor: string | null): Promise<{ ok: boolean; duplicate?: boolean }> {
  const { error } = await admin.from('call_team_members').insert({ call_id: callId, user_id: userId, category_id: categoryId, added_by: actor });
  return { ok: !error, duplicate: isDuplicate(error) };
}
export async function deleteMember(admin: SupabaseClient, callId: string, userId: string): Promise<void> {
  await admin.from('call_team_members').delete().eq('call_id', callId).eq('user_id', userId);
}
export async function updateMember(admin: SupabaseClient, callId: string, userId: string, patch: { category_id?: string; permission_overrides?: Partial<PermissionSet> }): Promise<void> {
  await admin.from('call_team_members').update({ ...patch, updated_at: new Date().toISOString() }).eq('call_id', callId).eq('user_id', userId);
}

// --- Who in the organisation may be in a team ----------------------------------------------------------------------

export interface OrgPerson { userId: string | null; email: string | null; name: string | null; role: string | null; eligible: boolean; reason: string | null }
export const NO_SEAT_REASON = 'No seat available. Seats are managed in About → Seats.';

async function emailOf(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email?.toLowerCase() ?? null;
}

/**
 * The organisation's people, for the "Add people" list. Only ACTIVE members are selectable: in v1 the evaluators are
 * members who hold a seat (§3, §9.3). Whoever has no seat yet is listed greyed out with the reason.
 */
export async function orgPeople(admin: SupabaseClient, org: OrgRef): Promise<OrgPerson[]> {
  if (org.kind === 'incubator') {
    const { data } = await admin.from('incubator_members').select('user_id, invited_email, role, full_name, status').eq('incubator_id', org.id);
    const out: OrgPerson[] = [];
    for (const m of (data ?? []) as Row[]) {
      if (m.status === 'removed') continue;
      const active = m.status === 'active' && !!m.user_id;
      out.push({
        userId: active ? (m.user_id as string) : null,
        email: active ? await emailOf(admin, m.user_id as string) : ((m.invited_email as string | null) ?? null),
        name: (m.full_name as string | null) ?? null, role: (m.role as string | null) ?? null,
        eligible: active, reason: active ? null : 'Has not accepted the invitation yet.',
      });
    }
    return out;
  }

  const { data: members } = await admin.from('matchdeal_investor_members').select('id, user_id, role').eq('catalog_entity_id', org.id).eq('status', 'active');
  const rows = (members ?? []) as Row[];
  const ids = rows.map((m) => m.id as string);
  const { data: profiles } = ids.length ? await admin.from('matchdeal_profiles').select('membership_id, representative_name').eq('kind', 'investor').in('membership_id', ids) : { data: [] };
  const nameBy = new Map(((profiles ?? []) as Row[]).map((p) => [p.membership_id as string, (p.representative_name as string | null) ?? null]));
  const out: OrgPerson[] = [];
  for (const m of rows) {
    out.push({ userId: m.user_id as string, email: await emailOf(admin, m.user_id as string), name: nameBy.get(m.id as string) ?? null, role: (m.role as string | null) ?? null, eligible: true, reason: null });
  }
  // A seat reserved for an email whose person has not claimed it yet: not available to be put in a team.
  const { data: invites } = await admin.from('investor_firm_seat_invites').select('email').eq('catalog_entity_id', org.id).eq('status', 'open');
  for (const i of (invites ?? []) as Row[]) out.push({ userId: null, email: i.email as string, name: null, role: null, eligible: false, reason: NO_SEAT_REASON });
  return out;
}

export async function isActiveOrgMember(admin: SupabaseClient, org: OrgRef, userId: string): Promise<boolean> {
  if (org.kind === 'incubator') {
    const { data } = await admin.from('incubator_members').select('id').eq('incubator_id', org.id).eq('user_id', userId).eq('status', 'active').limit(1);
    return (data ?? []).length > 0;
  }
  const { data } = await admin.from('matchdeal_investor_members').select('id').eq('catalog_entity_id', org.id).eq('user_id', userId).eq('status', 'active').limit(1);
  return (data ?? []).length > 0;
}

/** Names and emails of the people in a team, for the screen. */
export async function describePeople(admin: SupabaseClient, org: OrgRef, userIds: string[]): Promise<Map<string, { name: string | null; email: string | null; role: string | null }>> {
  const people = await orgPeople(admin, org);
  const out = new Map<string, { name: string | null; email: string | null; role: string | null }>();
  for (const p of people) if (p.userId) out.set(p.userId, { name: p.name, email: p.email, role: p.role });
  for (const id of userIds) if (!out.has(id)) out.set(id, { name: null, email: await emailOf(admin, id), role: null });
  return out;
}

// --- Starting point: a call always has an administrator -------------------------------------------------------------

/**
 * "Se a organização ainda não tiver nenhuma [categoria], cria-se Administrator com todas as permissões, e quem criou
 * a call fica nela." Idempotent: does nothing when the call already has a team. For a call that predates the team
 * (905/908), the creator goes in if they are still an active member, otherwise whoever is acting.
 */
export async function bootstrapTeam(admin: SupabaseClient, call: Call, actingUserId: string, opts: { alsoActor?: boolean } = {}): Promise<void> {
  const org = callOrg(call);
  if ((await loadCallTeam(admin, call.id)).length > 0) return;
  const categories = await loadCategories(admin, org);
  let category = categories.find((c) => isCallAdministrator(c.permissions));
  if (!category) {
    let name = ADMIN_CATEGORY_NAME;
    for (let n = 2; categories.some((c) => sameCategoryName(c.name, name)); n++) name = `${ADMIN_CATEGORY_NAME} ${n}`;
    const created = await createCategory(admin, org, name, { ...ALL_PERMISSIONS }, actingUserId);
    if (created.ok) category = created.category;
    else category = (await loadCategories(admin, org)).find((c) => isCallAdministrator(c.permissions)); // somebody else made it a moment ago
  }
  if (!category) return;
  const who = (await isActiveOrgMember(admin, org, call.createdBy)) ? call.createdBy : actingUserId;
  await insertMember(admin, call.id, who, category.id, actingUserId);
  // A call from before the team existed (905/908): whoever could manage it by their role keeps being able to.
  if (opts.alsoActor && who !== actingUserId) await insertMember(admin, call.id, actingUserId, category.id, actingUserId);
}

/** The teams of several calls in one go (the list needs to know, per call, whether the caller may configure it). */
export async function loadTeamsOfCalls(admin: SupabaseClient, callIds: string[]): Promise<Map<string, TeamMember[]>> {
  const out = new Map<string, TeamMember[]>(callIds.map((id) => [id, []]));
  if (!callIds.length) return out;
  const { data } = await admin.from('call_team_members').select('*').in('call_id', callIds);
  for (const r of (data ?? []) as Row[]) out.get(r.call_id as string)?.push(toMember(r));
  return out;
}

/** Duplicating a call copies its team (§5.3); the categories are the organisation's, so they are shared as they are. */
export async function copyTeam(admin: SupabaseClient, fromCallId: string, toCallId: string, actor: string): Promise<number> {
  const team = await loadCallTeam(admin, fromCallId);
  for (const m of team) await insertMember(admin, toCallId, m.userId, m.categoryId, actor);
  for (const m of team) if (Object.keys(m.overrides).length) await updateMember(admin, toCallId, m.userId, { permission_overrides: m.overrides });
  return team.length;
}

// --- Conflicts declared up front (§9.4) -------------------------------------------------------------------------------

export interface DeclaredConflict { id: string; userId: string; companyName: string; note: string | null; createdAt: string }

export async function loadConflicts(admin: SupabaseClient, callId: string): Promise<DeclaredConflict[]> {
  const { data } = await admin.from('call_declared_conflicts').select('*').eq('call_id', callId).order('created_at', { ascending: true });
  return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, userId: r.user_id as string, companyName: r.company_name as string, note: (r.note as string | null) ?? null, createdAt: r.created_at as string }));
}
export async function addConflict(admin: SupabaseClient, callId: string, userId: string, companyName: string, note: string | null, actor: string): Promise<boolean> {
  const { error } = await admin.from('call_declared_conflicts').insert({ call_id: callId, user_id: userId, company_name: companyName, note, declared_by: actor });
  return !error;
}
export async function removeConflict(admin: SupabaseClient, callId: string, conflictId: string): Promise<boolean> {
  const { data } = await admin.from('call_declared_conflicts').delete().eq('id', conflictId).eq('call_id', callId).select('id');
  return (data ?? []).length > 0;
}
