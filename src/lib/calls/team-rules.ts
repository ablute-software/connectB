// Prompt 909 (I3) — the rules of a call's team as pure functions over a small state: the categories of the
// organisation and the people of THIS call. Each change is computed on the state first; the route only writes it if
// the result is allowed. The one rule that cuts across them all: a call always has at least one person who can
// configure it AND manage its team (spec: "sempre um administrador").
import {
  cleanCategoryName, effectivePermissions, isCallAdministrator, sameCategoryName, type PermissionSet,
} from './permissions';

export interface TeamCategory { id: string; name: string; permissions: PermissionSet }
export interface TeamMember { userId: string; categoryId: string; overrides: Partial<PermissionSet> }
export interface TeamState { categories: TeamCategory[]; members: TeamMember[] }

export type TeamResult = { ok: true; state: TeamState } | { ok: false; error: string };

export const NO_ADMINISTRATOR =
  'Every call needs at least one person who can both configure the call and manage its team. This change would leave it with nobody.';

const fail = (error: string): TeamResult => ({ ok: false, error });

export function memberPermissions(state: TeamState, userId: string): PermissionSet | null {
  const m = state.members.find((x) => x.userId === userId);
  const c = m && state.categories.find((x) => x.id === m.categoryId);
  return m && c ? effectivePermissions(c.permissions, m.overrides) : null;
}

export function administrators(state: TeamState): string[] {
  return state.members.filter((m) => { const p = memberPermissions(state, m.userId); return !!p && isCallAdministrator(p); }).map((m) => m.userId);
}
export const hasAdministrator = (state: TeamState): boolean => administrators(state).length > 0;

/** The state after the change, or why not. The administrator rule is checked on the RESULT of every change. */
function guarded(state: TeamState): TeamResult {
  return hasAdministrator(state) ? { ok: true, state } : fail(NO_ADMINISTRATOR);
}

export function addMember(state: TeamState, userId: string, categoryId: string): TeamResult {
  if (state.members.some((m) => m.userId === userId)) return fail('That person is already in the team of this call.');
  if (!state.categories.some((c) => c.id === categoryId)) return fail('Choose a category.');
  return guarded({ ...state, members: [...state.members, { userId, categoryId, overrides: {} }] });
}

export function removeMember(state: TeamState, userId: string): TeamResult {
  if (!state.members.some((m) => m.userId === userId)) return fail('That person is not in the team of this call.');
  return guarded({ ...state, members: state.members.filter((m) => m.userId !== userId) });
}

export function setMemberCategory(state: TeamState, userId: string, categoryId: string): TeamResult {
  if (!state.members.some((m) => m.userId === userId)) return fail('That person is not in the team of this call.');
  if (!state.categories.some((c) => c.id === categoryId)) return fail('Choose a category.');
  return guarded({ ...state, members: state.members.map((m) => (m.userId === userId ? { ...m, categoryId } : m)) });
}

export function setMemberOverrides(state: TeamState, userId: string, overrides: Partial<PermissionSet>): TeamResult {
  if (!state.members.some((m) => m.userId === userId)) return fail('That person is not in the team of this call.');
  return guarded({ ...state, members: state.members.map((m) => (m.userId === userId ? { ...m, overrides } : m)) });
}

/** Switching a category's permissions changes everybody in it, in EVERY call that uses it (the caller checks each call). */
export function setCategoryPermissions(state: TeamState, categoryId: string, permissions: PermissionSet): TeamResult {
  if (!state.categories.some((c) => c.id === categoryId)) return fail('That category does not exist.');
  return guarded({ ...state, categories: state.categories.map((c) => (c.id === categoryId ? { ...c, permissions } : c)) });
}

// --- Categories of the organisation ------------------------------------------------------------------------------

export function validateNewCategoryName(existing: TeamCategory[], raw: unknown, exceptId?: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = cleanCategoryName(raw);
  if (!name) return { ok: false, error: 'Give the category a name (up to 60 characters).' };
  if (existing.some((c) => c.id !== exceptId && sameCategoryName(c.name, name))) return { ok: false, error: `There is already a category called “${name}” in your organisation.` };
  return { ok: true, name };
}

/** Deleting a category with people (in any call) obliges to move them first. `peopleByCategory` counts across the organisation. */
export function deleteCategoryProblem(category: TeamCategory, peopleInIt: number): string | null {
  if (peopleInIt > 0) return `“${category.name}” still has ${peopleInIt} ${peopleInIt === 1 ? 'person' : 'people'}. Move ${peopleInIt === 1 ? 'them' : 'them'} to another category first.`;
  return null;
}
