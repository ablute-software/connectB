// Prompt 907 (I5), the three adjustments after the 911 — through the REAL mailer (only the network and the send log are stubbed):
//  a) a call's emails reply to its "Contact email for applicants"; without one there is no Reply-To and only the central automated footer;
//  b) nothing here depends on an allowlist: any address registers (nothing in the notices reads AUTH_CODE_* or a test-address list);
//  c) every link in the emails — receipt, 48-hour reminder, new deadline — is absolute (https://www.sherlockdeal.com/...), from the same APP_URL helper.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/email-send-log', () => ({ logEmailSend: async () => undefined }));

type Posted = { to: string; subject: string; html: string; text?: string; reply_to?: string };
const posted: Posted[] = [];

beforeEach(() => {
  posted.length = 0;
  process.env.RESEND_API_KEY = 're_test_key';
  vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => { posted.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'em_1' }), text: async () => '' }; });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.NEXT_PUBLIC_APP_URL; vi.resetModules(); });

const TOKEN = 'tok-907-i5-0123456789abcdef';
const call = (contactEmail: string | null) => ({ name: 'Seed Call 2027', closesAt: '2026-10-20T10:00:00Z', timezone: 'Europe/Lisbon', linkToken: TOKEN, contactEmail });

async function load(appUrl = 'https://www.sherlockdeal.com') {
  process.env.NEXT_PUBLIC_APP_URL = appUrl;
  vi.resetModules();
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/email-send-log', () => ({ logEmailSend: async () => undefined }));
  return import('./notices');
}
const admin = { from: () => ({ update: () => ({ eq: async () => ({}) }) }) } as never;

describe('Reply-To and footer', () => {
  it('with a Contact email: that is the reply_to of the email, and it is not told "replies are not read"', async () => {
    const n = await load();
    const c = call('apply@fund.eu');
    await n.emailNotice(admin, null, 'a@b.com', c, n.noticeContent('submission_received', c, { reference: 'APP-1' }));
    expect(posted[0].reply_to).toBe('apply@fund.eu');
    expect(posted[0].html).not.toContain('Replies are not read');
  });
  it('without a Contact email: no Reply-To at all (no global fallback) and the central footer, with the link to /contact', async () => {
    const n = await load();
    const c = call(null);
    await n.emailNotice(admin, null, 'a@b.com', c, n.noticeContent('draft_reminder', c, { reference: 'APP-1' }));
    expect(posted[0]).not.toHaveProperty('reply_to');
    expect(posted[0].html).toContain('This is an automated message. Replies are not read.');
    expect(posted[0].html).toContain('https://www.sherlockdeal.com/contact');
    expect(posted[0].text).toContain('This is an automated message. Replies are not read.');
  });
  it('RESEND_REPLY_TO is not read', async () => {
    process.env.RESEND_REPLY_TO = 'owner@example.com';
    try {
      const n = await load(); const c = call(null);
      await n.emailNotice(admin, null, 'a@b.com', c, n.noticeContent('deadline_extended', c, { reference: null }));
      expect(JSON.stringify(posted)).not.toContain('owner@example.com');
    } finally { delete process.env.RESEND_REPLY_TO; }
  });
});

describe('absolute links', () => {
  it.each(['submission_received', 'draft_reminder', 'deadline_extended'] as const)('%s: the button and the text carry https://www.sherlockdeal.com/call/<token>', async (kind) => {
    const n = await load();
    const c = call('apply@fund.eu');
    await n.emailNotice(admin, null, 'a@b.com', c, n.noticeContent(kind, c, { reference: 'APP-1' }));
    const url = `https://www.sherlockdeal.com/call/${TOKEN}`;
    expect(posted[0].html).toContain(`href="${url}"`);
    expect(posted[0].text).toContain(url);
    expect(posted[0].html).not.toMatch(/href="\/(?!\/)/); // no relative href anywhere
  });
  it('a base without its scheme still gives an absolute link; no token gives the site root; a trailing slash does not double', async () => {
    const n = await load();
    expect(n.emailLinkFor({ linkToken: TOKEN }, 'www.sherlockdeal.com')).toBe(`https://www.sherlockdeal.com/call/${TOKEN}`);
    expect(n.emailLinkFor({ linkToken: TOKEN }, 'https://www.sherlockdeal.com/')).toBe(`https://www.sherlockdeal.com/call/${TOKEN}`);
    expect(n.emailLinkFor({ linkToken: null }, 'https://www.sherlockdeal.com/')).toBe('https://www.sherlockdeal.com');
  });
});

describe('no allowlist in the way', () => {
  it('the notices and the applicant routes read no AUTH_CODE_* variable and no test-address list', async () => {
    const fs = await import('node:fs'); const path = await import('node:path');
    const dirs = ['src/lib/calls/applicant', 'src/app/api/calls/apply', 'src/app/api/calls/public'];
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && !/\.test\./.test(f.name)) files.push(p); } };
    dirs.forEach((d) => walk(path.join(process.cwd(), d)));
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/AUTH_CODE_|AUTH_CODE_TEST_EMAILS|CALLS_TEST_EMAILS/);
  });
});
