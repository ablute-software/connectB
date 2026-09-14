import { describe, expect, it } from 'vitest';
import { landingDestination } from './landing-redirect';

describe('landingDestination', () => {
  it('sends an investor to the portal', () => {
    expect(landingDestination('investor')).toBe('/portal');
  });

  it('sends a founder and a developer to the pipeline', () => {
    expect(landingDestination('founder')).toBe('/pipeline');
    expect(landingDestination('developer')).toBe('/pipeline');
  });

  // The actual Prompt 515 regression: 'none' used to fall through the
  // ternary's else and land in the founder app.
  it('leaves a role-less session on the public landing', () => {
    expect(landingDestination('none')).toBeNull();
    expect(landingDestination('none')).not.toBe('/pipeline');
  });

  // Prompt 587 — a pending claim gets its own waiting page, never the
  // marketing landing ('none') and never the founder app ('founder').
  it('sends a pending-claim investor to the waiting page, not the landing or the founder app', () => {
    expect(landingDestination('investor_pending')).toBe('/claim/pending');
    expect(landingDestination('investor_pending')).not.toBeNull();
    expect(landingDestination('investor_pending')).not.toBe('/pipeline');
  });
});
