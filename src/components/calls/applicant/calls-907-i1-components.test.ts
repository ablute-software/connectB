// Prompt 907 (I1) — the screens of a call's link, rendered with react-dom/server (no DOM library in this repo): the header, the
// registration box on a call (the 904 component, variant "call") and what the page does with the link's memory.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CallHeader, type PublicCallInfo } from './CallHeader';
import { EmailCodeSignupView, type EmailCodeValues } from '@/components/auth/EmailCodeSignup';

const INFO: PublicCallInfo = {
  name: 'Seed Call 2027', description: 'Funding for early-stage health startups.', promoter: 'Portugal Ventures',
  opensAt: '2026-10-01T09:00:00Z', closesAt: '2027-03-31T16:00:00Z', timezone: 'Europe/Lisbon', phase: 'open', message: null, eligibility: [], regulation: null,
};
const header = (over: Partial<PublicCallInfo> = {}) => renderToStaticMarkup(createElement(CallHeader, { call: { ...INFO, ...over } }));

describe('the header (spec §13.1)', () => {
  it('has the entity, the title, the deadline with its time zone and the summary', () => {
    const html = header();
    expect(html).toContain('Portugal Ventures');
    expect(html).toContain('Seed Call 2027');
    expect(html).toContain('Europe/Lisbon');
    expect(html).toMatch(/31 Mar 2027, 17:00 \(Europe\/Lisbon\)/); // summer time: 16:00Z is 17:00 in Lisbon
    expect(html).toContain('Funding for early-stage health startups.');
  });
  it('shows the regulation link only when there is one, and the eligibility in sentences when there are any', () => {
    expect(header()).not.toContain('regulation-link');
    expect(header()).not.toContain('call-eligibility');
    const html = header({ regulation: { fileName: 'regulation.pdf', url: '/api/calls/public/tok/regulation' }, eligibility: ['Incorporated in the last 5 years'] });
    expect(html).toContain('href="/api/calls/public/tok/regulation"');
    expect(html).toContain('Incorporated in the last 5 years');
  });
  it('says "Opens on …" or "Applications closed on …" when applications cannot be made', () => {
    expect(header({ phase: 'scheduled', message: 'Opens on 20 Oct 2026' })).toContain('Opens on 20 Oct 2026');
    expect(header({ phase: 'closed', message: 'Applications closed on 31 Mar 2027' })).toContain('Applications closed on 31 Mar 2027');
  });
});

describe('the registration box on a call (spec §13.2)', () => {
  const VALUES: EmailCodeValues = { email: 'ana@example.com', fullName: 'Ana', startup: 'Acme', country: 'Portugal', role: 'CEO', password: 'Correct-Horse-9!', code: '' };
  const noop = () => {};
  const view = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(EmailCodeSignupView, {
    stage: 'form', values: VALUES, busy: false, error: '', notice: '', resendIn: 0, codeMessage: '', variant: 'call',
    onChange: noop, onSubmitForm: noop, onSubmitCode: noop, onResend: noop, onBack: noop, onCreateStartup: noop, ...over,
  }));

  it('explains the free account, has the eye on the password and the six fields', () => {
    const html = view();
    expect(html).toContain('free Sherlock Deal account');
    expect(html).toContain('additional plans');
    for (const f of ['Email *', 'Your name *', 'Startup *', 'Country *', 'Your role *', 'Password *']) expect(html).toContain(f);
    expect(html).toContain('aria-label="Show password"');
  });
  it('has the consents: the Terms (required) and the newsletter (optional, apart), and "Create account & continue"', () => {
    const html = view();
    expect(html).toContain('data-testid="terms-checkbox"');
    expect(html).toContain('Terms &amp; Conditions');
    expect(html).toContain('(optional)');
    expect(html).toContain('Create account &amp; continue');
  });
  it('the button waits for the Terms', () => {
    const disabled = (html: string) => /<button type="button" disabled=""[^>]*>Create account/.test(html);
    expect(disabled(view({ agreedToTerms: false }))).toBe(true);
    expect(disabled(view({ agreedToTerms: true }))).toBe(false);
  });
  it('the default variant (the 904 test page) is unchanged: no consents, "Create account"', () => {
    const html = view({ variant: 'default' });
    expect(html).not.toContain('terms-checkbox');
    expect(html).not.toContain('free Sherlock Deal account');
    expect(html).toContain('>Create account<');
  });
});

describe('the link keeps its memory (wiring of the page)', () => {
  const page = readFileSync('src/app/call/[token]/page.tsx', 'utf8');
  it('registration sends the confirmation email back to this very page, and "Sign in" returns to it', () => {
    expect(page).toMatch(/redirectPath=\{here\}/);
    expect(page).toContain('const here = `/call/${token}`');
    expect(page).toMatch(/\/login\?next=\$\{encodeURIComponent\(here\)\}/);
  });
  it('"Already have an account? Sign in" is always visible, also when the call is not open', () => {
    expect((page.match(/data-testid="signin-link"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('Already have an account?');
  });
  it('an account with no startup gets the startup step before the form', () => {
    expect(page).toMatch(/initialStage="startup"/);
  });
  it('never asks whether an email has an account (the session route only talks about whoever is signed in)', () => {
    expect(page).not.toMatch(/check-email|account-exists|exists\?/i);
  });
});
