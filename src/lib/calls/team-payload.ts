// Prompt 909 (I3) — everything the Team tab needs in one answer, built the same way for GET and for every change
// (so the screen never has to guess what a change did). Server-only: it names people.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { effectivePermissions, type PermissionSet } from './permissions';
import type { OrgRef, OrgPerson, DeclaredConflict } from './team-store';
import { categoryUsage, describePeople, loadCallTeam, loadCategories, loadConflicts, orgPeople } from './team-store';
import type { TeamCategory } from './team-rules';

export interface TeamPayload {
  ok: true;
  organisation: { kind: OrgRef['kind']; name: string };
  canManageTeam: boolean;
  categories: { id: string; name: string; permissions: PermissionSet; peopleInThisCall: number; peopleInOrganisation: number }[];
  members: { userId: string; name: string | null; email: string | null; orgRole: string | null; categoryId: string; overrides: Partial<PermissionSet>; effective: PermissionSet }[];
  candidates: OrgPerson[];
  conflicts: (DeclaredConflict & { personName: string | null; personEmail: string | null })[];
  /** True when the team has nobody who can configure the call and manage the team (it should never happen). */
  noAdministrator: boolean;
}

export async function buildTeamPayload(
  admin: SupabaseClient, call: { id: string; promoterKind: OrgRef['kind']; promoterId: string }, organisationName: string, canManageTeam: boolean,
): Promise<TeamPayload> {
  const org: OrgRef = { kind: call.promoterKind, id: call.promoterId };
  const [categories, members, people, conflicts] = await Promise.all([loadCategories(admin, org), loadCallTeam(admin, call.id), orgPeople(admin, org), loadConflicts(admin, call.id)]);
  const usage = await categoryUsage(admin, categories.map((c) => c.id));
  const described = await describePeople(admin, org, [...members.map((m) => m.userId), ...conflicts.map((c) => c.userId)]);
  const byId = new Map<string, TeamCategory>(categories.map((c) => [c.id, c]));
  const inTeam = new Set(members.map((m) => m.userId));

  const rows = members.map((m) => {
    const d = described.get(m.userId);
    const cat = byId.get(m.categoryId);
    return {
      userId: m.userId, name: d?.name ?? null, email: d?.email ?? null, orgRole: d?.role ?? null, categoryId: m.categoryId, overrides: m.overrides,
      effective: effectivePermissions(cat?.permissions ?? ({} as PermissionSet), m.overrides),
    };
  });
  return {
    ok: true, organisation: { kind: org.kind, name: organisationName }, canManageTeam,
    categories: categories.map((c) => ({
      id: c.id, name: c.name, permissions: c.permissions,
      peopleInThisCall: members.filter((m) => m.categoryId === c.id).length, peopleInOrganisation: usage.get(c.id) ?? 0,
    })),
    members: rows,
    candidates: people.filter((p) => !p.userId || !inTeam.has(p.userId)),
    conflicts: conflicts.map((c) => ({ ...c, personName: described.get(c.userId)?.name ?? null, personEmail: described.get(c.userId)?.email ?? null })),
    noAdministrator: !rows.some((r) => r.effective.configure_call && r.effective.manage_team),
  };
}
