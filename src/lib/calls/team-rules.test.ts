// Prompt 909 (I3) — permissions and the rules of a call's team, pure: what a category and individual adjustments
// add up to, which category names are acceptable, and the rule that cuts across every change: a call always has at
// least one person who can configure it AND manage its team.
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS, NO_PERMISSIONS, PERMISSIONS, PERMISSION_KEYS, SUGGESTED_CATEGORIES, cleanCategoryName, effectivePermissions, isCallAdministrator,
  normalizeOverrides, normalizePermissions, sameCategoryName,
} from './permissions';
import {
  NO_ADMINISTRATOR, addMember, administrators, deleteCategoryProblem, hasAdministrator, memberPermissions, removeMember, setCategoryPermissions,
  setMemberCategory, setMemberOverrides, validateNewCategoryName, type TeamState,
} from './team-rules';

const perms = (...on: (typeof PERMISSION_KEYS[number])[]) => ({ ...NO_PERMISSIONS, ...Object.fromEntries(on.map((k) => [k, true])) });
const state = (): TeamState => ({
  categories: [
    { id: 'admin', name: 'Administrator', permissions: { ...ALL_PERMISSIONS } },
    { id: 'eval', name: 'Evaluator', permissions: perms('evaluate_assigned') },
    { id: 'mgr', name: 'Manager', permissions: perms('configure_call') },
  ],
  members: [{ userId: 'ana', categoryId: 'admin', overrides: {} }, { userId: 'eva', categoryId: 'eval', overrides: {} }],
});

describe('the nine permissions', () => {
  it('are the nine of the spec, three enforced now (Prompt 907 added View all applications) and six stored for the next stage', () => {
    expect(PERMISSIONS.map((p) => p.key)).toEqual([...PERMISSION_KEYS]);
    expect(PERMISSION_KEYS).toHaveLength(9);
    expect(PERMISSIONS.filter((p) => p.enforced).map((p) => p.key)).toEqual(['configure_call', 'manage_team', 'view_all_applications']);
  });
  it('anything stored that is not a clear "true" is off; unknown keys are ignored', () => {
    expect(normalizePermissions(null)).toEqual(NO_PERMISSIONS);
    expect(normalizePermissions([true])).toEqual(NO_PERMISSIONS);
    expect(normalizePermissions({ configure_call: true, manage_team: 'yes', nonsense: true })).toEqual(perms('configure_call'));
  });
  it('individual adjustments keep real booleans only, and false is meaningful', () => {
    expect(normalizeOverrides({ configure_call: false, manage_team: 'x', evaluate_assigned: true, junk: true })).toEqual({ configure_call: false, evaluate_assigned: true });
    expect(normalizeOverrides('nope')).toEqual({});
  });
  it('a person has their category plus their own adjustments on top', () => {
    const cat = perms('evaluate_assigned', 'view_all_applications');
    expect(effectivePermissions(cat, {})).toEqual(cat);
    const adjusted = effectivePermissions(cat, { evaluate_assigned: false, final_decision: true });
    expect(adjusted).toMatchObject({ evaluate_assigned: false, final_decision: true, view_all_applications: true });
  });
  it('an administrator is whoever can both configure the call and manage the team', () => {
    expect(isCallAdministrator(perms('configure_call', 'manage_team'))).toBe(true);
    expect(isCallAdministrator(perms('configure_call'))).toBe(false);
    expect(isCallAdministrator(perms('manage_team'))).toBe(false);
  });
});

describe('category names', () => {
  it('are trimmed and collapsed; empty, too long and non-text are refused; the same name in another case is the same name', () => {
    expect(cleanCategoryName('  Finance   specialist ')).toBe('Finance specialist');
    expect(cleanCategoryName('   ')).toBeNull();
    expect(cleanCategoryName('x'.repeat(61))).toBeNull();
    expect(cleanCategoryName(42)).toBeNull();
    expect(sameCategoryName('Evaluator', '  evaluator ')).toBe(true);
    expect(sameCategoryName('Evaluator', 'Evaluators')).toBe(false);
  });
  it('a repeated name in the same organisation is refused, but a category may keep its own name when renamed', () => {
    const cats = state().categories;
    expect(validateNewCategoryName(cats, 'evaluator')).toEqual({ ok: false, error: 'There is already a category called “evaluator” in your organisation.' });
    expect(validateNewCategoryName(cats, 'Legal')).toEqual({ ok: true, name: 'Legal' });
    expect(validateNewCategoryName(cats, 'EVALUATOR', 'eval')).toEqual({ ok: true, name: 'EVALUATOR' });
    expect(validateNewCategoryName(cats, '')).toMatchObject({ ok: false });
  });
  it('the suggested list is the spec\'s', () => {
    expect([...SUGGESTED_CATEGORIES]).toEqual(['Evaluator', 'Manager', 'Analyst', 'Finance specialist', 'Technical specialist', 'Legal']);
  });
  it('a category with people cannot be deleted: they must be moved first', () => {
    const cat = state().categories[1];
    expect(deleteCategoryProblem(cat, 0)).toBeNull();
    expect(deleteCategoryProblem(cat, 1)).toContain('1 person');
    expect(deleteCategoryProblem(cat, 3)).toContain('3 people');
  });
});

describe('a call always has an administrator', () => {
  it('knows who they are', () => {
    expect(administrators(state())).toEqual(['ana']);
    expect(hasAdministrator(state())).toBe(true);
    expect(memberPermissions(state(), 'eva')).toEqual(perms('evaluate_assigned'));
    expect(memberPermissions(state(), 'stranger')).toBeNull();
  });
  it('removing the only administrator is refused; removing anybody else is fine', () => {
    expect(removeMember(state(), 'ana')).toEqual({ ok: false, error: NO_ADMINISTRATOR });
    expect(removeMember(state(), 'eva')).toMatchObject({ ok: true });
  });
  it('moving the only administrator to a category without both permissions is refused', () => {
    expect(setMemberCategory(state(), 'ana', 'eval')).toEqual({ ok: false, error: NO_ADMINISTRATOR });
    expect(setMemberCategory(state(), 'ana', 'mgr')).toEqual({ ok: false, error: NO_ADMINISTRATOR }); // configure but not manage
  });
  it('switching off one of the two permissions for the only administrator, individually, is refused', () => {
    expect(setMemberOverrides(state(), 'ana', { manage_team: false })).toEqual({ ok: false, error: NO_ADMINISTRATOR });
    expect(setMemberOverrides(state(), 'ana', { evaluate_assigned: false })).toMatchObject({ ok: true });
  });
  it('an adjustment can make a second person an administrator, and then the first may go', () => {
    const s = setMemberOverrides(state(), 'eva', { configure_call: true, manage_team: true });
    expect(s.ok).toBe(true);
    if (s.ok) expect(removeMember(s.state, 'ana')).toMatchObject({ ok: true });
  });
  it('changing a category\'s permissions that would strip the only administrator is refused', () => {
    expect(setCategoryPermissions(state(), 'admin', perms('configure_call'))).toEqual({ ok: false, error: NO_ADMINISTRATOR });
    expect(setCategoryPermissions(state(), 'eval', perms('final_decision'))).toMatchObject({ ok: true });
  });
  it('adding people: no duplicates, an unknown category is refused', () => {
    expect(addMember(state(), 'ana', 'eval')).toMatchObject({ ok: false });
    expect(addMember(state(), 'new', 'ghost')).toMatchObject({ ok: false });
    const added = addMember(state(), 'new', 'eval');
    expect(added).toMatchObject({ ok: true });
    if (added.ok) expect(added.state.members.map((m) => m.userId)).toEqual(['ana', 'eva', 'new']);
  });
  it('never changes the state it was given', () => {
    const s = state(); const snapshot = JSON.stringify(s);
    removeMember(s, 'eva'); setMemberCategory(s, 'eva', 'mgr'); setMemberOverrides(s, 'eva', { final_decision: true }); setCategoryPermissions(s, 'eval', ALL_PERMISSIONS);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
