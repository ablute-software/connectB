// Prompt 918 (Adenda 1, C) — the call's emails carry a small logo beside the entity's name: the call's own logo (an address on this platform, made absolute for the email client), else the entity's
// profile logo (https only), else nothing — and an email is never held back for a picture.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsDb, fakeCallsAdmin } from '@/test/fake-calls-db';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/email-send-log', () => ({ logEmailSend: async () => undefined }));

type Posted = { to: string; subject: string; html: string; text?: string };
const posted: Posted[] = [];
beforeEach(() => {
  posted.length = 0;
  process.env.RESEND_API_KEY = 're_test_key';
  vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => { posted.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'em_1' }), text: async () => '' }; });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.NEXT_PUBLIC_APP_URL; vi.resetModules(); });

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL_ID = '22222222-2222-4222-8222-222222222222';
const base = { id: CALL_ID, name: 'Seed Call 2027', closesAt: '2026-10-20T10:00:00Z', timezone: 'Europe/Lisbon', linkToken: 'tok-918-0123456789abcdef', contactEmail: null, promoterKind: 'catalog_entity' as const, promoterId: FIRM };

async function load() {
  process.env.NEXT_PUBLIC_APP_URL = 'https://www.sherlockdeal.com';
  vi.resetModules();
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/email-send-log', () => ({ logEmailSend: async () => undefined }));
  return import('./notices');
}
function world() {
  const db = callsDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'Portugal Ventures <b>', is_test: false });
  db.tables.matchdeal_investor_members.push({ id: 'm-1', user_id: 'u1', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' });
  return db;
}

describe('the logo beside the entity\'s name in the call\'s emails', () => {
  it('a logo uploaded for the call: its address on the platform, absolute, with the entity\'s name (escaped) beside it', async () => {
    const n = await load(); const db = world();
    const c = { ...base, logoPath: `calls/${CALL_ID}/logo-abc.png`, logoUpdatedAt: '2026-10-19T10:00:00Z' };
    await n.emailNotice(fakeCallsAdmin(db) as never, null, 'a@b.com', c, n.noticeContent('deadline_extended', c, { reference: null }));
    const html = posted[0].html;
    expect(html).toMatch(/<img src="https:\/\/www\.sherlockdeal\.com\/api\/calls\/public\/tok-918-0123456789abcdef\/logo\?v=\d+" alt="" width="28" height="28"/);
    expect(html).toContain('Portugal Ventures &lt;b&gt;');
    expect(html).not.toContain('Portugal Ventures <b>');
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<h1'));                          // above the heading
  });

  it('without its own logo, the entity\'s profile logo (https) is used as it is', async () => {
    const n = await load(); const db = world();
    db.tables.matchdeal_profiles.push({ membership_id: 'm-1', entity_logo_url: 'https://cdn.example/firm.png' });
    await n.emailNotice(fakeCallsAdmin(db) as never, null, 'a@b.com', base, n.noticeContent('draft_reminder', base, { reference: 'APP-1' }));
    expect(posted[0].html).toContain('<img src="https://cdn.example/firm.png"');
  });

  it('a profile logo that is not https is not put in an email; with no logo at all there is no image', async () => {
    const n = await load(); const db = world();
    db.tables.matchdeal_profiles.push({ membership_id: 'm-1', entity_logo_url: 'http://cdn.example/firm.png' });
    await n.emailNotice(fakeCallsAdmin(db) as never, null, 'a@b.com', base, n.noticeContent('submission_received', base, { reference: 'APP-1' }));
    expect(posted[0].html).not.toContain('<img');
  });

  it('the email goes out even if the logo cannot be looked up', async () => {
    const n = await load();
    const broken = { from: () => { throw new Error('database unavailable'); } } as never;
    const sent = await n.emailNotice(broken, null, 'a@b.com', base, n.noticeContent('deadline_extended', base, { reference: null }));
    expect(sent).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0].html).not.toContain('<img');
  });
});
