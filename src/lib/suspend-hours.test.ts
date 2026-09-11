import { describe, expect, it } from 'vitest';
import { validateSuspendHours, MAX_SUSPEND_HOURS } from './suspend-hours';

describe('validateSuspendHours (Prompt 870 §B)', () => {
  it('treats null/undefined as a valid indefinite suspension', () => {
    expect(validateSuspendHours(null)).toEqual({ ok: true, indefinite: true });
    expect(validateSuspendHours(undefined)).toEqual({ ok: true, indefinite: true });
  });
  it('accepts a valid finite window', () => {
    expect(validateSuspendHours(24)).toEqual({ ok: true, indefinite: false });
    expect(validateSuspendHours(MAX_SUSPEND_HOURS)).toEqual({ ok: true, indefinite: false });
  });
  it('rejects a present but out-of-range value', () => {
    expect(validateSuspendHours(0).ok).toBe(false);
    expect(validateSuspendHours(-1).ok).toBe(false);
    expect(validateSuspendHours(9000).ok).toBe(false);
    expect(validateSuspendHours(Number.NaN).ok).toBe(false);
  });
});
