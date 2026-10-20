// Prompt 918 (follow-up to the I1 test) — what a click looks like on the Team tab before the server has answered, and which clicks are folded into one save.
import { describe, expect, it } from 'vitest';
import type { TeamPayload } from './team-payload';
import { ALL_PERMISSIONS, NO_PERMISSIONS, SUGGESTED_CATEGORIES, SUGGESTED_CATEGORY_PERMISSIONS, suggestedPermissions } from './permissions';
import { applyChange, applyChanges, debounceKey, isOptimistic } from './team-optimistic';

const ADMIN = 'cat-admin'; const EVAL = 'cat-eval';
const base = (): TeamPayload => ({
  ok: true, organisation: { kind: 'catalog_entity', name: 'Firm' }, canManageTeam: true,
  categories: [
    { id: ADMIN, name: 'Administrator', permissions: { ...ALL_PERMISSIONS }, peopleInThisCall: 1, peopleInOrganisation: 1 },
    { id: EVAL, name: 'Evaluator', permissions: { ...NO_PERMISSIONS, evaluate_assigned: true }, peopleInThisCall: 1, peopleInOrganisation: 1 },
  ],
  members: [
    { userId: 'ana', name: 'Ana', email: 'ana@x.test', orgRole: 'admin', categoryId: ADMIN, overrides: {}, effective: { ...ALL_PERMISSIONS } },
    { userId: 'bob', name: 'Bob', email: 'bob@x.test', orgRole: 'member', categoryId: EVAL, overrides: {}, effective: { ...NO_PERMISSIONS, evaluate_assigned: true } },
  ],
  candidates: [
    { userId: 'dora', name: 'Dora', email: 'dora@x.test', role: 'member', eligible: true, reason: null },
    { userId: 'zed', name: 'Zed', email: 'zed@x.test', role: 'member', eligible: false, reason: 'No seat available.' },
  ],
  conflicts: [], noAdministrator: false,
});

describe('a switch of a category', () => {
  it('changes the category AND what everybody in it effectively has, without touching the others', () => {
    const d = applyChange(base(), { action: 'set_category_permissions', categoryId: EVAL, permissions: { ...NO_PERMISSIONS, evaluate_assigned: true, view_all_applications: true } });
    expect(d.categories.find((c) => c.id === EVAL)!.permissions.view_all_applications).toBe(true);
    expect(d.members.find((m) => m.userId === 'bob')!.effective.view_all_applications).toBe(true);
    expect(d.members.find((m) => m.userId === 'ana')!.effective).toEqual(ALL_PERMISSIONS);
  });
  it('turning off the last administrator\'s power shows the warning at once (the server would refuse; the screen then goes back)', () => {
    const d = applyChange(base(), { action: 'set_category_permissions', categoryId: ADMIN, permissions: { ...ALL_PERMISSIONS, manage_team: false } });
    expect(d.noAdministrator).toBe(true);
  });
  it('a person\'s own adjustment wins over their category', () => {
    const d = applyChange(base(), { action: 'set_overrides', userId: 'bob', overrides: { evaluate_assigned: false, final_decision: true } });
    expect(d.members.find((m) => m.userId === 'bob')!.effective).toMatchObject({ evaluate_assigned: false, final_decision: true });
    expect(d.members.find((m) => m.userId === 'bob')!.overrides).toEqual({ evaluate_assigned: false, final_decision: true });
  });
});

describe('a person\'s category, adding and removing', () => {
  it('moving a person updates both categories\' counts and the person\'s effective permissions', () => {
    const d = applyChange(base(), { action: 'set_category', userId: 'bob', categoryId: ADMIN });
    expect(d.members.find((m) => m.userId === 'bob')!.effective).toEqual(ALL_PERMISSIONS);
    expect(d.categories.map((c) => [c.id, c.peopleInThisCall, c.peopleInOrganisation])).toEqual([[ADMIN, 2, 2], [EVAL, 0, 0]]);
  });
  it('adding takes the person out of the "can be added" list and puts them in the team with the category\'s permissions', () => {
    const d = applyChange(base(), { action: 'add_member', userId: 'dora', categoryId: EVAL });
    expect(d.candidates.map((p) => p.userId)).toEqual(['zed']);
    expect(d.members.find((m) => m.userId === 'dora')).toMatchObject({ name: 'Dora', email: 'dora@x.test', categoryId: EVAL, effective: { evaluate_assigned: true, configure_call: false } });
    expect(d.categories.find((c) => c.id === EVAL)!.peopleInThisCall).toBe(2);
  });
  it('a person with no seat is never added on the screen (the server would refuse, and the screen does not pretend)', () => {
    expect(applyChange(base(), { action: 'add_member', userId: 'zed', categoryId: EVAL })).toEqual(base());
  });
  it('removing puts the person back in the list of people who can be added', () => {
    const d = applyChange(base(), { action: 'remove_member', userId: 'bob' });
    expect(d.members.map((m) => m.userId)).toEqual(['ana']);
    expect(d.candidates.map((p) => p.userId)).toContain('bob');
    expect(d.categories.find((c) => c.id === EVAL)!.peopleInThisCall).toBe(0);
  });
  it('a change that makes no sense for this picture leaves it exactly as it is', () => {
    for (const change of [{ action: 'set_category', userId: 'nobody', categoryId: ADMIN }, { action: 'set_category', userId: 'bob', categoryId: 'nope' }, { action: 'remove_member', userId: 'nobody' },
      { action: 'set_overrides', userId: 'nobody', overrides: {} }, { action: 'rename_category', categoryId: EVAL, name: 'x' }]) expect(applyChange(base(), change)).toEqual(base());
  });
  it('changes are applied in order, on top of what the server last confirmed', () => {
    const d = applyChanges(base(), [{ action: 'add_member', userId: 'dora', categoryId: EVAL }, { action: 'set_category', userId: 'dora', categoryId: ADMIN }]);
    expect(d.members.find((m) => m.userId === 'dora')!.categoryId).toBe(ADMIN);
  });
  it('never mutates the picture it was given', () => {
    const before = JSON.stringify(base()); const b = base();
    applyChange(b, { action: 'remove_member', userId: 'bob' });
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('which clicks show at once, and which are folded into one save', () => {
  it('switches, a person\'s category, adding and removing are shown at once; creating, renaming, deleting and conflicts wait for the server', () => {
    for (const action of ['set_category_permissions', 'set_overrides', 'set_category', 'add_member', 'remove_member']) expect(isOptimistic({ action }), action).toBe(true);
    for (const action of ['create_category', 'rename_category', 'delete_category', 'declare_conflict', 'remove_conflict']) expect(isOptimistic({ action }), action).toBe(false);
  });
  it('only the two that send the whole set are debounced, one key per category and per person', () => {
    expect(debounceKey({ action: 'set_category_permissions', categoryId: 'a' })).toBe('permissions:category:a');
    expect(debounceKey({ action: 'set_overrides', userId: 'u' })).toBe('permissions:person:u');
    expect(debounceKey({ action: 'set_category_permissions', categoryId: 'a' })).not.toBe(debounceKey({ action: 'set_category_permissions', categoryId: 'b' }));
    for (const action of ['set_category', 'add_member', 'remove_member', 'create_category']) expect(debounceKey({ action, userId: 'u', categoryId: 'a' })).toBeNull();
  });
});

describe('the suggestions', () => {
  it('every suggestion has defaults; none of them can run the team (Manager has everything BUT Manage team)', () => {
    for (const s of SUGGESTED_CATEGORIES) { expect(SUGGESTED_CATEGORY_PERMISSIONS[s], s).toBeDefined(); expect(SUGGESTED_CATEGORY_PERMISSIONS[s].manage_team, s).toBe(false); }
    expect(Object.values(SUGGESTED_CATEGORY_PERMISSIONS.Manager).filter(Boolean)).toHaveLength(8);
  });
  it('is found whatever the case or spacing, and returns a copy nobody can alter for the next call', () => {
    expect(suggestedPermissions('  evaluator ')).toEqual({ ...NO_PERMISSIONS, evaluate_assigned: true });
    expect(suggestedPermissions('Head of Research')).toBeNull();
    suggestedPermissions('Evaluator')!.final_decision = true;
    expect(SUGGESTED_CATEGORY_PERMISSIONS.Evaluator.final_decision).toBe(false);
  });
});
