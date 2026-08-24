import { describe, it, expect } from 'vitest';
import { isTreatedForWaveDosage } from './investor-pipeline';

describe('isTreatedForWaveDosage', () => {
  it('a real decision (interested/passed) always counts as treated', () => {
    expect(isTreatedForWaveDosage({ status: 'interested' })).toBe(true);
    expect(isTreatedForWaveDosage({ status: 'passed' })).toBe(true);
  });

  it('a plain open card, never touched, is not treated', () => {
    expect(isTreatedForWaveDosage({ status: 'open' })).toBe(false);
    expect(isTreatedForWaveDosage({ status: 'open', isArchived: false })).toBe(false);
  });

  it('Prompt 345 §A.3 — an archived-but-still-open card counts as treated', () => {
    expect(isTreatedForWaveDosage({ status: 'open', isArchived: true })).toBe(true);
  });

  it('an archived AND decided card is still treated (no double negative)', () => {
    expect(isTreatedForWaveDosage({ status: 'interested', isArchived: true })).toBe(true);
  });
});
