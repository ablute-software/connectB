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

// Prompt I-01c §A.3/§A.6 — the account invited to an ecosystem organisation's
// team must never become an orphan founder (Nuno's production test, 30/09).
import { goesToPendingMemberInvite, PENDING_MEMBER_INVITE_PATH } from './landing-redirect';

describe('aterragem de quem foi convidado para a equipa de uma organização (I-01c)', () => {
  it('sem org + convite pendente → página de aceitação', () => {
    expect(landingDestination('none', { pendingIncubatorMemberInvite: true })).toBe(PENDING_MEMBER_INVITE_PATH);
  });
  it('sem org + sem convite → como hoje (null: página pública / orphan repair no shell)', () => {
    expect(landingDestination('none', {})).toBeNull();
    expect(goesToPendingMemberInvite('none', { pendingIncubatorMemberInvite: false, signupIntent: null })).toBe(false);
  });
  it('conta criada a partir do convite de membro (signup_intent) nunca cai no orphan repair, mesmo sem convite pendente', () => {
    expect(goesToPendingMemberInvite('none', { signupIntent: 'incubator_member' })).toBe(true);
    expect(landingDestination('none', { signupIntent: 'incubator_member' })).toBe(PENDING_MEMBER_INVITE_PATH);
  });
  it('quem já tem casa não é desviado (founder, incubator, investor, developer)', () => {
    for (const role of ['founder', 'incubator', 'investor', 'developer', 'investor_pending'] as const) {
      expect(goesToPendingMemberInvite(role, { pendingIncubatorMemberInvite: true, signupIntent: 'incubator_member' })).toBe(false);
    }
  });
  it('o workspace da organização mudou para /ecosystem', () => {
    expect(landingDestination('incubator')).toBe('/ecosystem');
  });
});
