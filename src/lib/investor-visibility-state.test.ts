import { describe, expect, it } from 'vitest';
import { investorVisibilityCopy, investorVisibilityState } from './investor-visibility-state';

describe('investorVisibilityState', () => {
  it('is visible when the gate is complete and nobody switched it off', () => {
    expect(investorVisibilityState({ gateComplete: true, ownerSuspended: false, platformSuspended: false })).toBe('visible');
  });

  it('is incomplete when the nine-field gate is unfinished', () => {
    expect(investorVisibilityState({ gateComplete: false, ownerSuspended: false, platformSuspended: false })).toBe('incomplete');
  });

  // The whole point of §B: the founder's own switch, and it must read as
  // their decision rather than as something they forgot to fill in.
  it('reports the founder\'s own opt-out ahead of incompleteness', () => {
    expect(investorVisibilityState({ gateComplete: false, ownerSuspended: true, platformSuspended: false })).toBe('hidden');
    expect(investorVisibilityState({ gateComplete: true, ownerSuspended: true, platformSuspended: false })).toBe('hidden');
  });

  it('lets a platform suspension outrank everything', () => {
    expect(investorVisibilityState({ gateComplete: true, ownerSuspended: true, platformSuspended: true })).toBe('platform_hidden');
    expect(investorVisibilityState({ gateComplete: false, ownerSuspended: false, platformSuspended: true })).toBe('platform_hidden');
  });
});

describe('investorVisibilityCopy — the three states §B specifies', () => {
  it('names how many fields are missing, and pluralises', () => {
    expect(investorVisibilityCopy('incomplete', { missingCount: 3 }).detail).toBe("Investors can't find you yet — 3 fields missing.");
    expect(investorVisibilityCopy('incomplete', { missingCount: 1 }).detail).toBe("Investors can't find you yet — 1 field missing.");
  });

  it('says plainly that investors can find you', () => {
    expect(investorVisibilityCopy('visible').detail).toBe('Investors can find you.');
    expect(investorVisibilityCopy('visible', { pipelineFirmCount: 0 }).detail).toBe('Investors can find you.');
    expect(investorVisibilityCopy('visible', { pipelineFirmCount: null }).detail).toBe('Investors can find you.');
  });

  it('adds the real firm count when there is one, and pluralises the verb', () => {
    expect(investorVisibilityCopy('visible', { pipelineFirmCount: 1 }).detail)
      .toBe('Investors can find you — 1 investor firm has you in their pipeline.');
    expect(investorVisibilityCopy('visible', { pipelineFirmCount: 4 }).detail)
      .toBe('Investors can find you — 4 investor firms have you in their pipeline.');
  });

  it('attributes the hidden state to the founder, not to the platform', () => {
    expect(investorVisibilityCopy('hidden').detail).toBe('Hidden from investor pipelines by you.');
    expect(investorVisibilityCopy('platform_hidden').detail).toBe("Contact support — this wasn't your choice.");
  });

  it('is amber or worse for every state that means investors cannot see you', () => {
    expect(investorVisibilityCopy('visible').tone).toBe('ok');
    for (const s of ['incomplete', 'hidden', 'platform_hidden'] as const) {
      expect(investorVisibilityCopy(s).tone).not.toBe('ok');
    }
  });
});
