// Prompt 909 (I3) — the team of a call (spec §9): the categories of the organisation, who is in this call and
// with what permissions, who else could be added (only active members with a seat), and the conflicts declared up
// front. Anyone who belongs to the organisation may LOOK; every change needs "Manage team & permissions" in this
// call (the owner of the organisation always has it). The team is not call configuration: it is edited whatever
// the state of the call, and every change goes into the call's history.
//
//   GET                                       the whole picture (TeamPayload)
//   POST { action: 'add_member', userId, categoryId }
//        { action: 'remove_member', userId }
//        { action: 'set_category', userId, categoryId }
//        { action: 'set_overrides', userId, overrides }          "Adjust permissions for this person"
//        { action: 'create_category', name, permissions?, assignUserId? }   organisation-wide: reused in every call; a suggested name starts with sensible permissions; assignUserId puts that person in it (adds them to the call if they are not in it)
//        { action: 'rename_category', categoryId, name }
//        { action: 'delete_category', categoryId }               refused while anybody is in it
//        { action: 'set_category_permissions', categoryId, permissions }   changes it in EVERY call that uses it
//        { action: 'declare_conflict', userId, companyName, note? } / { action: 'remove_conflict', conflictId }
// Every change is computed on the pure rules (team-rules.ts) first and refused if it would leave a call without
// anybody who can configure it and manage its team.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { normalizeOverrides, normalizePermissions, NO_PERMISSIONS, suggestedPermissions } from '@/lib/calls/permissions';
import {
  addMember, deleteCategoryProblem, hasAdministrator, NO_ADMINISTRATOR, removeMember, setCategoryPermissions, setMemberCategory, setMemberOverrides,
  validateNewCategoryName, type TeamCategory, type TeamResult,
} from '@/lib/calls/team-rules';
import { buildTeamPayload } from '@/lib/calls/team-payload';
import {
  addConflict, callOrg, categoryUsage, createCategory, deleteCategory, deleteMember, insertMember, isActiveOrgMember, loadCallTeam, loadCategories,
  NO_SEAT_REASON, removeConflict, renameCategory, teamsUsingCategory, updateCategoryPermissions, updateMember,
} from '@/lib/calls/team-store';
import { loadCall, logCallEvent } from '@/lib/calls/store';

// A request argument keeps Next from prerendering it; the answer is per person anyway.
export const dynamic = 'force-dynamic';

const refuse = (error: string, status = 409, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  return NextResponse.json(await buildTeamPayload(auth.admin, auth.call, auth.promoter.name, auth.perms.manage_team));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'team' });
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const done = async () => NextResponse.json(await buildTeamPayload(auth.admin, auth.call, auth.promoter.name, true));
  const log = (event: string, detail: Record<string, unknown>) => logCallEvent(auth.admin, auth.call.id, event, auth.userId, detail);
  const org = callOrg(auth.call);
  const { admin, call } = auth;
  const catName = (id: string) => auth.team.categories.find((c) => c.id === id)?.name ?? null;
  const apply = (res: TeamResult) => (res.ok ? null : refuse(res.error));

  switch (str(b.action)) {
    case 'add_member': {
      const userId = str(b.userId); const categoryId = str(b.categoryId);
      // In v1 evaluators are members who hold a seat: only ACTIVE members of the organisation can be added.
      if (!userId || !(await isActiveOrgMember(admin, org, userId))) return refuse(NO_SEAT_REASON);
      const bad = apply(addMember(auth.team, userId, categoryId)); if (bad) return bad;
      const ins = await insertMember(admin, call.id, userId, categoryId, auth.userId);
      if (!ins.ok) return refuse(ins.duplicate ? 'That person is already in the team of this call.' : 'Could not add the person.');
      await log('team_member_added', { userId, category: catName(categoryId) });
      return done();
    }
    case 'remove_member': {
      const userId = str(b.userId);
      const bad = apply(removeMember(auth.team, userId)); if (bad) return bad;
      await deleteMember(admin, call.id, userId);
      await log('team_member_removed', { userId });
      return done();
    }
    case 'set_category': {
      const userId = str(b.userId); const categoryId = str(b.categoryId);
      const bad = apply(setMemberCategory(auth.team, userId, categoryId)); if (bad) return bad;
      await updateMember(admin, call.id, userId, { category_id: categoryId });
      await log('team_member_category_changed', { userId, category: catName(categoryId) });
      return done();
    }
    case 'set_overrides': {
      const userId = str(b.userId); const overrides = normalizeOverrides(b.overrides);
      const bad = apply(setMemberOverrides(auth.team, userId, overrides)); if (bad) return bad;
      await updateMember(admin, call.id, userId, { permission_overrides: overrides });
      await log('team_member_permissions_adjusted', { userId, overrides });
      return done();
    }

    case 'create_category': {
      const name = validateNewCategoryName(auth.team.categories, b.name);
      if (!name.ok) return refuse(name.error);
      // A suggested name (Evaluator, Manager, Analyst…) starts with sensible permissions; any other name, with none (the person switches them on).
      const permissions = b.permissions === undefined ? (suggestedPermissions(name.name) ?? { ...NO_PERMISSIONS }) : normalizePermissions(b.permissions);
      // "Create it and put this person in it" in one step (the person's own list offers the suggestions): checked on the team as it WOULD be, before anything is written,
      // so a refusal leaves no half-made category behind.
      const assignTo = str(b.assignUserId);
      if (assignTo) {
        const trial: TeamCategory = { id: '__new__', name: name.name, permissions };
        const withNew = { ...auth.team, categories: [...auth.team.categories, trial] };
        const isMember = auth.team.members.some((m) => m.userId === assignTo);
        if (!isMember && !(await isActiveOrgMember(admin, org, assignTo))) return refuse(NO_SEAT_REASON);
        const bad = apply(isMember ? setMemberCategory(withNew, assignTo, trial.id) : addMember(withNew, assignTo, trial.id)); if (bad) return bad;
        const created = await createCategory(admin, org, name.name, permissions, auth.userId);
        if (!created.ok) return refuse(created.error);
        await log('team_category_created', { category: name.name });
        if (isMember) {
          await updateMember(admin, call.id, assignTo, { category_id: created.category.id });
          await log('team_member_category_changed', { userId: assignTo, category: name.name });
        } else {
          const ins = await insertMember(admin, call.id, assignTo, created.category.id, auth.userId);
          if (!ins.ok) return refuse(ins.duplicate ? 'That person is already in the team of this call.' : 'Could not add the person.');
          await log('team_member_added', { userId: assignTo, category: name.name });
        }
        return done();
      }
      const created = await createCategory(admin, org, name.name, permissions, auth.userId);
      if (!created.ok) return refuse(created.error);
      await log('team_category_created', { category: name.name });
      return done();
    }
    case 'rename_category': {
      const categoryId = str(b.categoryId);
      const current = auth.team.categories.find((c) => c.id === categoryId);
      if (!current) return refuse('That category does not exist.', 404);
      const name = validateNewCategoryName(auth.team.categories, b.name, categoryId);
      if (!name.ok) return refuse(name.error);
      const renamed = await renameCategory(admin, categoryId, name.name);
      if (!renamed.ok) return refuse(renamed.error);
      await log('team_category_renamed', { from: current.name, to: name.name });
      return done();
    }
    case 'delete_category': {
      const categoryId = str(b.categoryId);
      const current = auth.team.categories.find((c) => c.id === categoryId);
      if (!current) return refuse('That category does not exist.', 404);
      // Across ALL the calls of the organisation: the category is theirs, not this call's.
      const people = (await categoryUsage(admin, [categoryId])).get(categoryId) ?? 0;
      const problem = deleteCategoryProblem(current, people);
      if (problem) return refuse(problem);
      if (!(await deleteCategory(admin, categoryId))) return refuse('Could not delete the category. Move its people first.');
      await log('team_category_deleted', { category: current.name });
      return done();
    }
    case 'set_category_permissions': {
      const categoryId = str(b.categoryId);
      const current = auth.team.categories.find((c) => c.id === categoryId);
      if (!current) return refuse('That category does not exist.', 404);
      const permissions = normalizePermissions(b.permissions);
      // The category is shared: every call that has somebody in it must keep an administrator.
      const categories = (await loadCategories(admin, org)).map((c) => (c.id === categoryId ? { ...c, permissions } : c));
      for (const [callId, members] of await teamsUsingCategory(admin, categoryId)) {
        if (!hasAdministrator({ categories, members })) {
          const other = callId === call.id ? call : await loadCall(admin, callId);
          return refuse(callId === call.id ? NO_ADMINISTRATOR : `${NO_ADMINISTRATOR} (The call “${other?.name ?? 'another call'}” would be left without one.)`);
        }
      }
      const bad = apply(setCategoryPermissions(auth.team, categoryId, permissions)); if (bad) return bad;
      await updateCategoryPermissions(admin, categoryId, permissions);
      await log('team_category_permissions_changed', { category: current.name, permissions });
      return done();
    }

    case 'declare_conflict': {
      const userId = str(b.userId);
      const company = str(b.companyName).replace(/\s+/g, ' ').trim().slice(0, 200);
      const note = str(b.note).trim().slice(0, 500) || null;
      if (!(await loadCallTeam(admin, call.id)).some((m) => m.userId === userId)) return refuse('Choose a person of this call’s team.');
      if (!company) return refuse('Write the name of the company.');
      if (!(await addConflict(admin, call.id, userId, company, note, auth.userId))) return refuse('Could not record the conflict.');
      await log('conflict_declared', { userId, company });
      return done();
    }
    case 'remove_conflict': {
      if (!(await removeConflict(admin, call.id, str(b.conflictId)))) return refuse('That conflict does not exist.', 404);
      await log('conflict_removed', { conflictId: str(b.conflictId) });
      return done();
    }
    default: return refuse('Unknown action.', 400);
  }
}
