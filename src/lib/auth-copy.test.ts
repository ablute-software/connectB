// Prompt 906 §C — "Forgot your password?" must not promise an email it cannot know it sent.
// Renders the REAL confirmation component with react-dom/server (no DOM needed), the way PasswordInput.test.ts does.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FORGOT_PASSWORD_SENT_COPY } from '@/lib/auth-copy';
import { ForgotPasswordSent } from '@/components/auth/ForgotPasswordSent';

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const typed = 'joao.loureiro@zz-test-906.example';
const html = decode(renderToStaticMarkup(createElement(ForgotPasswordSent, { email: typed, onStartOver: () => {} })));
const page = readFileSync(path.resolve(__dirname, '../app/forgot-password/page.tsx'), 'utf8');

describe('forgot-password: the confirmation after "Send reset link"', () => {
  it('is the sentence Nuno asked for, word for word', () => {
    expect(FORGOT_PASSWORD_SENT_COPY).toBe(
      "If an account exists for this address, you'll receive an email in a minute. Check spam, and make sure it's the address you signed up with.",
    );
  });

  it('says nothing that reveals whether the account exists: conditional, and no "we\'ve sent"', () => {
    expect(FORGOT_PASSWORD_SENT_COPY.startsWith('If an account exists')).toBe(true);
    expect(FORGOT_PASSWORD_SENT_COPY).not.toMatch(/we(?:'|’)ve sent|we sent|has been sent|was sent/i);
    expect(FORGOT_PASSWORD_SENT_COPY).not.toMatch(/no account|not found|doesn(?:'|’)t exist|unknown/i);
  });

  it('what the screen renders is that sentence — the old promise is gone', () => {
    expect(html).toContain(FORGOT_PASSWORD_SENT_COPY);
    expect(html).not.toMatch(/we(?:'|’)ve sent|has an account, we/i);
  });

  it('shows the address that was typed, so a wrong one can be seen — and the way back says what it is for', () => {
    expect(html).toContain(typed);
    expect(html).toContain('Wrong address? Start over');
    expect(html).not.toContain('Not you? Start over');
    // the way back is a button wired to the page's own "start over"
    expect(html).toMatch(/<button[^>]*>Wrong address\? Start over<\/button>/);
  });

  it('the page renders that component for the "sent" state, and nothing else says the link went out', () => {
    expect(page).toContain("import { ForgotPasswordSent } from '@/components/auth/ForgotPasswordSent'");
    expect(page).toContain('<ForgotPasswordSent email={email} onStartOver={startOver} />');
    expect(page).not.toMatch(/has an account, we/i);
  });
});
