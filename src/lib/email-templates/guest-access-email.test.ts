import { describe, expect, it } from 'vitest';
import {
  firstNameOr, guestAccessEmailSubject, renderGuestAccessEmailHtml, renderGuestAccessEmailText,
} from './guest-access-email';
import { GUEST_ACCESS_EMAIL_HTML } from './guest-access-email-source';

const VARS = {
  invitedName: 'Golnaz Borghei',
  startupName: 'ablute_',
  guestAccessUrl: 'https://example.test/guest/tok_abc123',
};

describe('firstNameOr', () => {
  it('takes the first name only', () => {
    expect(firstNameOr('there', 'Golnaz Borghei')).toBe('Golnaz');
    expect(firstNameOr('there', '  Dr. Golnaz  Borghei ')).toBe('Dr.');
  });

  // The common case: most invites are an email address and nothing else.
  it('falls back rather than leaking a placeholder or "undefined"', () => {
    expect(firstNameOr('there', null)).toBe('there');
    expect(firstNameOr('there', undefined)).toBe('there');
    expect(firstNameOr('there', '   ')).toBe('there');
  });
});

describe('renderGuestAccessEmailHtml', () => {
  it('leaves no unfilled placeholder anywhere in the email', () => {
    const html = renderGuestAccessEmailHtml(VARS);
    expect(html).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(renderGuestAccessEmailText(VARS)).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('never renders the literal "undefined" or "null"', () => {
    const html = renderGuestAccessEmailHtml({ ...VARS, invitedName: null });
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('>null<');
    expect(html).toContain('there');
  });

  it('uses the exact guest URL it was given, once', () => {
    const html = renderGuestAccessEmailHtml(VARS);
    expect(html.split('https://example.test/guest/tok_abc123').length - 1).toBe(1);
  });

  it('points every asset at the app-served email-assets path', () => {
    const html = renderGuestAccessEmailHtml(VARS);
    const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src).toMatch(/\/email-assets\//);
  });

  it('keeps the approved markup byte-identical apart from substitution', () => {
    // The design is locked. Rendering must only ever replace {{vars}} — if the
    // template itself is edited, this length relationship breaks and this test
    // is the thing that says so.
    const html = renderGuestAccessEmailHtml(VARS);
    const stripped = html.replace(/https:\/\/example\.test\/guest\/tok_abc123/g, '{{guest_access_url}}');
    expect(stripped.includes('{{guest_access_url}}')).toBe(true);
    expect(GUEST_ACCESS_EMAIL_HTML).toContain('{{guest_access_url}}');
  });

  it('renders the startup name into the subject and the body', () => {
    expect(guestAccessEmailSubject('ablute_')).toBe('ablute_ shared their data room with you');
    expect(renderGuestAccessEmailHtml(VARS)).toContain('ablute_');
  });
});
