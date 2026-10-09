// Prompt 904 Part B — the screens of the code registration, rendered with react-dom/server
// (no DOM library in this repo; same approach as PasswordInput.test.ts). Written as .ts with
// createElement. What this cannot show — typing, the countdown ticking, a reload restoring the
// fields — is checked live in the browser.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmailCodeSignupView, resendLabel, type EmailCodeValues } from './EmailCodeSignup';

const VALUES: EmailCodeValues = {
  email: 'ana@example.com', fullName: 'Ana', startup: 'S', country: 'PT', role: 'CEO', password: 'Correct-Horse-9!', code: '',
};
const noop = () => {};
function render(over: Partial<Parameters<typeof EmailCodeSignupView>[0]> = {}) {
  return renderToStaticMarkup(createElement(EmailCodeSignupView, {
    stage: 'form', values: VALUES, busy: false, error: '', notice: '', resendIn: 0, codeMessage: 'We sent a code to ana@example.com.',
    onChange: noop, onSubmitForm: noop, onSubmitCode: noop, onResend: noop, onBack: noop, onCreateStartup: noop, ...over,
  }));
}

describe('form stage', () => {
  it('asks for the six things the spec lists, with the eye on the password', () => {
    const html = render();
    for (const f of ['Email *', 'Your name *', 'Startup *', 'Country *', 'Your role *', 'Password *']) expect(html).toContain(f);
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('At least 10 characters');
  });

  it('keeps the button disabled until everything is filled and the password meets the policy', () => {
    const disabled = (html: string) => /<button type="button" disabled=""[^>]*>Create account/.test(html);
    expect(disabled(render())).toBe(false);
    expect(disabled(render({ values: { ...VALUES, password: 'weak' } }))).toBe(true);
    expect(disabled(render({ values: { ...VALUES, startup: '' } }))).toBe(true);
  });
});

describe('code stage', () => {
  it('shows the sentence the server sent, a one-time-code box and no account hint', () => {
    const html = render({ stage: 'code' });
    expect(html).toContain('We sent a code to ana@example.com.');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).not.toMatch(/already (have|has|registered)/i);
  });

  it('keeps resend locked with a visible countdown, unlocks at zero', () => {
    const locked = render({ stage: 'code', resendIn: 42 });
    expect(locked).toContain('Resend code in 42s');
    expect(/data-testid="resend"[^>]*disabled=""|disabled=""[^>]*data-testid="resend"/.test(locked)).toBe(true);
    const open = render({ stage: 'code', resendIn: 0 });
    expect(open).toContain('Send a new code');
    expect(/disabled=""[^>]*data-testid="resend"/.test(open)).toBe(false);
  });

  it('confirm needs exactly six digits', () => {
    const disabled = (html: string) => /<button type="button" disabled=""[^>]*>Confirm/.test(html);
    expect(disabled(render({ stage: 'code', values: { ...VALUES, code: '12345' } }))).toBe(true);
    expect(disabled(render({ stage: 'code', values: { ...VALUES, code: '123456' } }))).toBe(false);
  });

  it('after a reload (no password in memory) it asks for the password again instead of hiding the gap', () => {
    const html = render({ stage: 'code', values: { ...VALUES, password: '' } });
    expect(html).toContain('Choose your password *');
  });

  it('shows the error and the notice as announced regions', () => {
    const html = render({ stage: 'code', error: "That code didn't work. 4 attempts left.", notice: 'A new code is on its way.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
  });

  it('lets the person go back to change the email', () => {
    expect(render({ stage: 'code' })).toContain('Use another email');
  });
});

describe('startup and done stages', () => {
  it('a signed-in user without a startup is asked for name and country only', () => {
    const html = render({ stage: 'startup' });
    expect(html).toContain('Startup name *');
    expect(html).toContain('Country *');
    expect(html).not.toContain('Password *');
  });

  it('done confirms and carries a warning when the password step failed', () => {
    const html = render({ stage: 'done', notice: 'Please choose a password on the next screen.' });
    expect(html).toContain('Your email is confirmed');
    expect(html).toContain('Please choose a password');
  });
});

describe('resendLabel', () => {
  it('counts down and then offers the action', () => {
    expect(resendLabel(60)).toBe('Resend code in 60s');
    expect(resendLabel(0)).toBe('Send a new code');
  });
});
