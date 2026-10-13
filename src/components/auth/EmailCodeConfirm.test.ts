// Prompt 911 — the shared "enter your code" step and the Backoffice failure panel, rendered with react-dom/server (no DOM
// library in this repo). Typing, the countdown ticking and a reload are covered by pending-storage.test.ts, client.test.ts
// and the live check in the report; here: what each state SAYS.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeStepView } from './CodeStep';
import { EmailCodeConfirm } from './EmailCodeConfirm';
import { AuthEmailFailuresView, type AuthFailureRow } from '@/components/backoffice/AuthEmailFailuresPanel';
import { AuthMessage } from './AuthMessage';
import { SEND_FAILED_TEXT } from '@/lib/auth-errors';

const noop = () => {};
const view = (over: Partial<Parameters<typeof CodeStepView>[0]> = {}) => renderToStaticMarkup(createElement(CodeStepView, {
  email: 'ana@example.com', code: '', password: 'Correct-Horse-9!', busy: false, error: '', notice: '', resendIn: 0,
  message: 'We sent a code to ana@example.com.', onCodeChange: noop, onPasswordChange: noop, onSubmit: noop, onResend: noop, onChangeEmail: noop, ...over,
}));

describe('the code step (spec A, flow 2)', () => {
  it('says where the code went, offers Resend code and Change email, and keeps the link as the alternative', () => {
    const html = view({ changeLabel: 'Change email' });
    expect(html).toContain('We sent a code to ana@example.com.');
    expect(html).toContain('Send a new code');
    expect(html).toContain('Change email');
    expect(html).toContain('data-testid="link-alternative"');
    expect(html).toContain('click the button in the same email');
    expect(html).toContain('The code is valid for 30 minutes');
  });

  it('shows the resend countdown while the gap runs', () => {
    expect(view({ resendIn: 42 })).toContain('Resend code in 42s');
  });

  it('asks for the password again after a reload (it is never stored) and not otherwise', () => {
    expect(view({ password: '' })).toContain('Choose your password *');
    expect(view({ password: 'Correct-Horse-9!' })).not.toContain('Choose your password *');
  });

  it('Confirm waits for six digits', () => {
    const disabled = (html: string) => /<button type="button" disabled=""[^>]*data-testid="code-confirm"/.test(html) || /<button[^>]*data-testid="code-confirm"[^>]*disabled=""/.test(html);
    expect(disabled(view({ code: '12345' }))).toBe(true);
    expect(disabled(view({ code: '123456' }))).toBe(false);
  });

  it('an error is shown as the sentence it was given', () => {
    const html = view({ error: SEND_FAILED_TEXT });
    expect(html).toContain('role="alert"');
    expect(html).toContain("We couldn&#x27;t send the email right now");
    expect(html).not.toContain('{}');
  });

  it('the stateful wrapper renders the same step for a given email (what a reload shows)', () => {
    const html = renderToStaticMarkup(createElement(EmailCodeConfirm, { email: 'ana@example.com', password: '', sentAt: Date.now(), onVerified: noop, onChangeEmail: noop }));
    expect(html).toContain('data-testid="code-step"');
    expect(html).toContain('We sent a code to ana@example.com.');
    expect(html).toContain('Change email');
    expect(html).toContain('Choose your password *');
  });
});

describe('"contact us" is a link to the contact form, not an address', () => {
  it('the send-failed message links to /contact and prints no email', () => {
    const html = renderToStaticMarkup(createElement(AuthMessage, { text: SEND_FAILED_TEXT }));
    expect(html).toContain('<a href="/contact"');
    expect(html).toContain('>contact us</a>');
    expect(html).toContain('If it keeps failing, ');
    expect(html).not.toContain('@');
    expect(html).not.toContain('mailto:');
  });
  it('a message without the phrase is plain text', () => {
    expect(renderToStaticMarkup(createElement(AuthMessage, { text: 'Too many attempts. Please wait a few minutes.' }))).toBe('Too many attempts. Please wait a few minutes.');
  });
  it('the code step shows the link when the send failed', () => {
    expect(view({ error: SEND_FAILED_TEXT })).toContain('href="/contact"');
  });
});

describe('the Backoffice failure panel (spec B.2)', () => {
  const ROW: AuthFailureRow = {
    id: 1, created_at: '2026-10-12T16:22:58Z', email: 'malhaoverde@gmail.com', action: 'signup', source: 'server',
    http_status: 500, error_code: 'unexpected_failure', error_message: 'gomail: could not send email 1: 550 "The sherlockdeal.com domain is not verified"',
  };
  const panel = (over: Partial<Parameters<typeof AuthEmailFailuresView>[0]> = {}) =>
    renderToStaticMarkup(createElement(AuthEmailFailuresView, { rows: [ROW], last24h: 1, peopleLast24h: 1, ...over }));

  it('raises a red alert when something failed in the last 24 hours, with how many people', () => {
    const html = panel({ last24h: 8, peopleLast24h: 4 });
    expect(html).toContain('data-testid="failures-alert"');
    expect(html).toContain('8 failures in the last 24 hours, affecting 4 people');
  });

  it('says plainly when there is nothing', () => {
    const html = panel({ rows: [], last24h: 0, peopleLast24h: 0 });
    expect(html).toContain('data-testid="failures-clear"');
    expect(html).not.toContain('failure-row');
  });

  it('lists email, what, and the provider\'s own text verbatim', () => {
    const html = panel();
    expect(html).toContain('malhaoverde@gmail.com');
    expect(html).toContain('Sign-up code / confirmation');
    expect(html).toContain('500 · unexpected_failure');
    expect(html).toContain('domain is not verified');
  });
});
