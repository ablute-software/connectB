// Prompt 911 (follow-up) — platform emails carry NO Reply-To and end with "automated message, replies are not read, contact us";
// an email with its own explicit Reply-To (a call's contact for applicants) keeps it and does not get that line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATED_FOOTER_TEXT, CONTACT_URL, automatedFooterHtml, withAutomatedFooter } from './email-footer';

describe('the footer', () => {
  it('says what it must, with a link to the contact form and no address', () => {
    expect(AUTOMATED_FOOTER_TEXT).toBe('This is an automated message. Replies are not read. Need help? Contact us at sherlockdeal.com/contact');
    const html = automatedFooterHtml();
    expect(html).toContain('This is an automated message. Replies are not read. Need help? Contact us at ');
    expect(html).toContain(`<a href="${CONTACT_URL}"`);
    expect(html).toContain('>sherlockdeal.com/contact</a>');
    expect(html).not.toMatch(/@|mailto:/);
  });

  it('is added to a platform email (html and the plain-text part), once', () => {
    const once = withAutomatedFooter({ html: '<p>Hi</p>', text: 'Hi' });
    expect(once.html).toContain('<p>Hi</p>');
    expect(once.html).toContain('data-automated-footer');
    expect(once.text).toBe(`Hi\n\n${AUTOMATED_FOOTER_TEXT}\n${CONTACT_URL}`);
    const twice = withAutomatedFooter({ html: once.html, text: once.text });
    expect(twice).toEqual(once);
  });

  it('leaves a missing plain-text part missing (html-only emails stay html-only)', () => {
    expect(withAutomatedFooter({ html: '<p>Hi</p>' }).text).toBeUndefined();
  });

  it('is NOT added when the email has an explicit Reply-To of its own', () => {
    expect(withAutomatedFooter({ html: '<p>Hi</p>', text: 'Hi', replyTo: 'programme@fund.example' })).toEqual({ html: '<p>Hi</p>', text: 'Hi' });
  });
});

describe('what the mailer sends', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'em_1' }), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.resetModules();
    vi.doMock('./email-send-log', () => ({ logEmailSend: vi.fn(async () => {}) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('./email-send-log'); });
  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;

  it('a platform email has no reply_to — even with RESEND_REPLY_TO set in the environment — and ends with the footer', async () => {
    vi.stubEnv('RESEND_REPLY_TO', 'sherlockdeal.com@gmail.com');
    const { sendTransactionalEmail } = await import('./resend');
    await sendTransactionalEmail({ to: 'a@b.co', subject: 's', html: '<p>Hello</p>', text: 'Hello' });
    const b = body();
    expect(b).not.toHaveProperty('reply_to');
    expect(JSON.stringify(b)).not.toContain('sherlockdeal.com@gmail.com');
    expect(String(b.html)).toContain('Replies are not read');
    expect(String(b.html)).toContain('href="https://www.sherlockdeal.com/contact"');
    expect(String(b.text)).toContain('Replies are not read');
  });

  it('a call email with its own Reply-To keeps it and has no "replies are not read" line', async () => {
    const { sendTransactionalEmail } = await import('./resend');
    await sendTransactionalEmail({ to: 'a@b.co', subject: 's', html: '<p>Hello</p>', replyTo: 'programme@fund.example' });
    const b = body();
    expect(b.reply_to).toBe('programme@fund.example');
    expect(String(b.html)).not.toContain('Replies are not read');
  });
});
