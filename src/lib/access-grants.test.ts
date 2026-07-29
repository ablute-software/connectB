import { describe, expect, it } from 'vitest';
import { grantStatus, grantIsActive } from './access-grants';

const NOW = new Date('2026-07-29T12:00:00Z');
const BASE = { invited_email: null, confirmed_at: null, revoked_at: null, expires_at: null };

describe('grantStatus', () => {
  it('a grant predating invited_email (or founder-created by hand) is active by default', () => {
    expect(grantStatus(BASE, NOW)).toBe('active');
  });

  it('revoked always wins, even over an unconfirmed invite', () => {
    expect(grantStatus({ ...BASE, invited_email: 'a@b.com', revoked_at: '2026-07-01T00:00:00Z' }, NOW)).toBe('revoked');
  });

  it('expired wins over an unconfirmed invite', () => {
    expect(grantStatus({ ...BASE, invited_email: 'a@b.com', expires_at: '2026-01-01T00:00:00Z' }, NOW)).toBe('expired');
  });

  it('invited_email set + confirmed_at null -> pending_confirmation', () => {
    expect(grantStatus({ ...BASE, invited_email: 'a@b.com' }, NOW)).toBe('pending_confirmation');
  });

  it('invited_email set + confirmed_at set -> active', () => {
    expect(grantStatus({ ...BASE, invited_email: 'a@b.com', confirmed_at: '2026-07-20T00:00:00Z' }, NOW)).toBe('active');
  });

  it('a hand-created grant (invited_email null) is never pending, regardless of confirmed_at', () => {
    expect(grantStatus(BASE, NOW)).toBe('active');
  });

  it('an expiry in the future does not expire the grant', () => {
    expect(grantStatus({ ...BASE, expires_at: '2027-01-01T00:00:00Z' }, NOW)).toBe('active');
  });
});

describe('grantIsActive', () => {
  it('mirrors grantStatus === active', () => {
    expect(grantIsActive(BASE, NOW)).toBe(true);
    expect(grantIsActive({ ...BASE, invited_email: 'a@b.com' }, NOW)).toBe(false);
  });
});
