import { describe, expect, it } from 'vitest';
import { canWithMatrix, DEFAULT_MATRIX, resolveMatrix } from './org-permissions';

describe('resolveMatrix', () => {
  it('returns the defaults when there are no overrides', () => {
    expect(resolveMatrix(null)).toEqual(DEFAULT_MATRIX);
    expect(resolveMatrix(undefined)).toEqual(DEFAULT_MATRIX);
  });

  it('applies an override for one capability, leaving the rest at default', () => {
    const m = resolveMatrix({ invites: ['owner', 'admin', 'manager'] });
    expect(m.invites).toEqual(['owner', 'admin', 'manager']);
    expect(m.org_editing).toEqual(DEFAULT_MATRIX.org_editing);
  });

  it('forces the owner into every capability even if an override omits them', () => {
    const m = resolveMatrix({ data_room_read: ['member'], org_editing: [] });
    expect(m.data_room_read[0]).toBe('owner');
    expect(m.org_editing).toEqual(['owner']);
  });

  it('ignores a non-array override value', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = resolveMatrix({ invites: 'nope' as any });
    expect(m.invites).toEqual(DEFAULT_MATRIX.invites);
  });
});

describe('canWithMatrix', () => {
  const m = resolveMatrix({ data_room_manage: ['owner', 'admin', 'manager'] });

  it('grants a role listed for the capability', () => {
    expect(canWithMatrix(m, 'manager', 'data_room_manage')).toBe(true);
  });

  it('denies a role not listed', () => {
    expect(canWithMatrix(m, 'member', 'data_room_manage')).toBe(false);
  });

  it('always grants the owner', () => {
    expect(canWithMatrix(resolveMatrix({ org_editing: [] }), 'owner', 'org_editing')).toBe(true);
  });

  it('denies a null role', () => {
    expect(canWithMatrix(m, null, 'invites')).toBe(false);
  });
});
