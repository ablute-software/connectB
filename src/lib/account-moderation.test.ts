import { describe, expect, it } from 'vitest';
import {
  computeQuarantineUntil, isQuarantineActive, canSuspend, canUndo, canDelete, isLoginBlocked, isVisibleToOthers,
  computeSuspendedUntil, isSuspensionActive,
} from './account-moderation';

describe('computeQuarantineUntil', () => {
  it('adds exactly 30 days', () => {
    expect(computeQuarantineUntil('2026-01-01T00:00:00.000Z')).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('isQuarantineActive', () => {
  it('is false when there is no quarantine date', () => {
    expect(isQuarantineActive(null, '2026-02-01T00:00:00Z')).toBe(false);
  });
  it('is true while now is before the quarantine end', () => {
    expect(isQuarantineActive('2026-01-31T00:00:00Z', '2026-01-15T00:00:00Z')).toBe(true);
  });
  it('is false once now is at or past the quarantine end', () => {
    expect(isQuarantineActive('2026-01-31T00:00:00Z', '2026-01-31T00:00:00Z')).toBe(false);
    expect(isQuarantineActive('2026-01-31T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(false);
  });
});

describe('state machine — canSuspend / canUndo / canDelete', () => {
  it('can only suspend an active account', () => {
    expect(canSuspend('active')).toBe(true);
    expect(canSuspend('suspended')).toBe(false);
    expect(canSuspend('deleted')).toBe(false);
  });
  it('can only undo a suspended account', () => {
    expect(canUndo('suspended')).toBe(true);
    expect(canUndo('active')).toBe(false);
    expect(canUndo('deleted')).toBe(false);
  });
  it('can only delete a suspended account whose quarantine has elapsed', () => {
    expect(canDelete('suspended', '2026-01-31T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(true);
    expect(canDelete('suspended', '2026-01-31T00:00:00Z', '2026-01-15T00:00:00Z')).toBe(false);
    expect(canDelete('active', null, '2026-02-01T00:00:00Z')).toBe(false);
    expect(canDelete('deleted', null, '2026-02-01T00:00:00Z')).toBe(false);
  });
});

describe('computeSuspendedUntil', () => {
  it('adds the given number of hours', () => {
    expect(computeSuspendedUntil('2026-01-01T00:00:00.000Z', 48)).toBe('2026-01-03T00:00:00.000Z');
  });
});

describe('isSuspensionActive', () => {
  it('is indefinitely active when there is no suspendedUntil date (the plain-suspend default)', () => {
    expect(isSuspensionActive(null, '2026-02-01T00:00:00Z')).toBe(true);
  });
  it('is true while now is before the suspension end', () => {
    expect(isSuspensionActive('2026-01-31T00:00:00Z', '2026-01-15T00:00:00Z')).toBe(true);
  });
  it('is false once now is at or past the suspension end', () => {
    expect(isSuspensionActive('2026-01-31T00:00:00Z', '2026-01-31T00:00:00Z')).toBe(false);
    expect(isSuspensionActive('2026-01-31T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(false);
  });
});

describe('isLoginBlocked / isVisibleToOthers', () => {
  it('only an active account may log in — an indefinite suspension (no suspendedUntil) blocks like before', () => {
    expect(isLoginBlocked('active', null, '2026-02-01T00:00:00Z')).toBe(false);
    expect(isLoginBlocked('suspended', null, '2026-02-01T00:00:00Z')).toBe(true);
    expect(isLoginBlocked('deleted', null, '2026-02-01T00:00:00Z')).toBe(true);
  });
  it('a time-boxed suspension stops blocking login once suspendedUntil has passed', () => {
    expect(isLoginBlocked('suspended', '2026-01-31T00:00:00Z', '2026-01-15T00:00:00Z')).toBe(true);
    expect(isLoginBlocked('suspended', '2026-01-31T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(false);
  });
  it('deleted always blocks login regardless of suspendedUntil', () => {
    expect(isLoginBlocked('deleted', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(true);
  });
  it('only an active account (or a lapsed time-boxed suspension) is visible to the other side / ecosystem_facts', () => {
    expect(isVisibleToOthers('active', null, '2026-02-01T00:00:00Z')).toBe(true);
    expect(isVisibleToOthers('suspended', null, '2026-02-01T00:00:00Z')).toBe(false);
    expect(isVisibleToOthers('deleted', null, '2026-02-01T00:00:00Z')).toBe(false);
    expect(isVisibleToOthers('suspended', '2026-01-31T00:00:00Z', '2026-02-01T00:00:00Z')).toBe(true);
  });
});
