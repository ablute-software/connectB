import { describe, expect, it } from 'vitest';
import { hasMissingRequiredField } from './confirm-fields';

// Prompt 704 (18/09/2026) — pipeline-drop.ts's drag-to-requalify dialogs need
// a reason that can't be skipped. The dialog itself is a portal-rendered
// 'use client' component (no jsdom in this project — see FrostedGate.test.ts's
// own header), so only the pure gating decision behind its disabled Confirm
// button is unit-tested here.

describe('hasMissingRequiredField', () => {
  it('is false when there are no fields at all', () => {
    expect(hasMissingRequiredField(undefined, {})).toBe(false);
    expect(hasMissingRequiredField([], {})).toBe(false);
  });

  it('is false when no field is marked required, however empty the values are', () => {
    expect(hasMissingRequiredField([{ key: 'reason', label: 'Reason', type: 'text' }], {})).toBe(false);
  });

  it('is true when a required field has no value at all', () => {
    expect(hasMissingRequiredField([{ key: 'reason', label: 'Reason', type: 'text', required: true }], {})).toBe(true);
  });

  it('is true when a required field is present but blank or whitespace-only', () => {
    const fields = [{ key: 'reason', label: 'Reason', type: 'text' as const, required: true }];
    expect(hasMissingRequiredField(fields, { reason: '' })).toBe(true);
    expect(hasMissingRequiredField(fields, { reason: '   ' })).toBe(true);
  });

  it('is false once the required field has real content', () => {
    const fields = [{ key: 'reason', label: 'Reason', type: 'text' as const, required: true }];
    expect(hasMissingRequiredField(fields, { reason: 'No reply in 3 weeks' })).toBe(false);
  });

  it('checks every required field, not just the first', () => {
    const fields = [
      { key: 'revisit_date', label: 'Revisit on', type: 'date' as const, required: true },
      { key: 'reason', label: 'Reason', type: 'text' as const, required: true },
    ];
    expect(hasMissingRequiredField(fields, { revisit_date: '2026-10-10', reason: '' })).toBe(true);
    expect(hasMissingRequiredField(fields, { revisit_date: '2026-10-10', reason: 'ok' })).toBe(false);
  });
});
