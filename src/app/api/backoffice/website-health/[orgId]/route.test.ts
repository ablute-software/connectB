// Prompt 919 E — the back office's side of website health, through the real handlers: platform admin only; the Ficha reads the RAW reason
// of a failed check (a founder never does) and whether the key is set; "Force re-check" ignores the 7-day limit, stores what Google said,
// and leaves a row in the audit log. There is no other way for a check to run outside the founder's own request.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, type FakeDb } from '@/test/fake-supabase';

const h = vi.hoisted(() => ({ isAdmin: true, admin: null as unknown, available: true }));
vi.mock('@/lib/backoffice-auth', () => ({
  requirePlatformAdmin: async () => (h.isAdmin
    ? { admin: h.admin, userId: 'bo-1' }
    : { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) }),
}));
vi.mock('@/lib/website-health-capability', () => ({ websiteHealthAvailable: async () => h.available }));

import { GET, POST, maxDuration } from './route';

const ORG = 'a0a0a0a0-0000-4000-8000-00000000000a';
const KEY = 'AIzaSyTESTONLYabcdefghijklmnopqrstuvwx';
const fixture = (n: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../../../../lib/__fixtures__/${n}`), 'utf8')) as unknown;
const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const req = (method: string) => new Request(`https://example.test/api/backoffice/website-health/${ORG}`, { method });

let db: FakeDb;
let googleUrls: URL[];
let google: (u: URL) => Response;

const goodRow = (strategy: 'mobile' | 'desktop', at: string) => ({
  id: `r-${strategy}`, org_id: ORG, url: 'https://www.example.com', strategy, fetched_at: at,
  score_performance: 61, score_seo: 85, score_accessibility: 82, score_best_practices: 96, lcp_ms: 1243, cls: '0.0011', inp_ms: null, audits: { items: [{ id: 'bootup-time', title: 'Reduce JavaScript execution time' }, { id: 'link-text', title: 'Links do not have descriptive text' }] },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'));
  vi.stubEnv('PAGESPEED_API_KEY', KEY);
  h.isAdmin = true; h.available = true;
  db = fakeDb({
    orgs: [{ id: ORG, name: 'zz-test-site-A', website: 'https://www.example.com/', website_score_visible: true }],
    org_website_audits: [],
    admin_audit_log: [],
  });
  db.applyWrites = true;
  h.admin = fakeAdmin(db);
  googleUrls = [];
  google = (u) => new Response(JSON.stringify({ lighthouseResult: fixture(u.searchParams.get('strategy') === 'mobile' ? 'pagespeed-heavy-mobile.json' : 'pagespeed-example-mobile.json') }), { status: 200 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const u = new URL(typeof input === 'string' ? input : input.toString());
    if (u.hostname !== 'www.googleapis.com') throw new Error(`unexpected network call to ${u.hostname}`);
    googleUrls.push(u);
    return google(u);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const json = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('platform admin only', () => {
  it('a non-admin gets 403 on both methods and the database is not touched', async () => {
    h.isAdmin = false;
    expect((await GET(req('GET'), ctx(ORG))).status).toBe(403);
    expect((await POST(req('POST'), ctx(ORG))).status).toBe(403);
    expect(db.writes).toEqual([]);
    expect(googleUrls).toEqual([]);
  });

  it('an id that is not a UUID is refused before anything is read', async () => {
    expect((await GET(req('GET'), ctx('not-a-uuid'))).status).toBe(400);
    expect((await POST(req('POST'), ctx("x'; drop table orgs;--"))).status).toBe(400);
    expect(googleUrls).toEqual([]);
  });

  it('declares a 60 s function', () => { expect(maxDuration).toBe(60); });
});

describe('GET — what the Ficha shows', () => {
  it('the last analysis of each strategy with its date and the number of findings; the switch; and that the key is set — never the key itself', async () => {
    db.tables.org_website_audits.push(goodRow('mobile', '2026-10-14T09:00:00.000Z'), goodRow('desktop', '2026-10-14T09:00:00.000Z'));
    const res = await GET(req('GET'), ctx(ORG));
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, available: true, orgName: 'zz-test-site-A', rawWebsite: 'https://www.example.com/', website: 'https://www.example.com', keyConfigured: true, visibleToInvestors: true });
    expect(body.latest.mobile).toMatchObject({ fetchedAt: '2026-10-14T09:00:00.000Z', ok: true, findings: 2, scores: { performance: 61, seo: 85, accessibility: 82, bestPractices: 96 }, error: null });
    expect(body.allowance).toEqual({ allowed: false, reason: 'too_soon', nextCheckAt: '2026-10-21T09:00:00.000Z' });
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('a failed check shows the RAW reason (kind + Google\'s message) to the back office — that is the point of it', async () => {
    db.tables.org_website_audits.push({
      id: 'f1', org_id: ORG, url: 'https://www.example.com', strategy: 'mobile', fetched_at: '2026-10-16T11:00:00.000Z',
      score_performance: null, score_seo: null, score_accessibility: null, score_best_practices: null, lcp_ms: null, cls: null, inp_ms: null,
      audits: { error: { kind: 'quota', message: "Quota exceeded for quota metric 'Queries'", httpStatus: 429 } },
    });
    const body = await json(await GET(req('GET'), ctx(ORG)));
    expect(body.latest.mobile).toMatchObject({ ok: false, error: { kind: 'quota', message: "Quota exceeded for quota metric 'Queries'", httpStatus: 429 } });
    expect(body.latest.desktop).toBeNull();
  });

  it('says plainly when the key is NOT set on this deployment', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '');
    expect((await json(await GET(req('GET'), ctx(ORG)))).keyConfigured).toBe(false);
  });

  it('a startup that does not exist: 404', async () => {
    expect((await GET(req('GET'), ctx('b0b0b0b0-0000-4000-8000-00000000000b'))).status).toBe(404);
  });

  it('the migration is not applied: the card says nothing instead of failing', async () => {
    h.available = false;
    expect(await json(await GET(req('GET'), ctx(ORG)))).toEqual({ ok: true, available: false });
  });

  it('is a read: nothing is written, Google is not asked', async () => {
    await GET(req('GET'), ctx(ORG));
    expect(db.writes).toEqual([]);
    expect(googleUrls).toEqual([]);
  });
});

describe('POST — Force re-check', () => {
  it('ignores the 7 days: a good analysis from yesterday does not stop the admin; both strategies run, are stored, and the audit log says who and what', async () => {
    db.tables.org_website_audits.push(goodRow('mobile', '2026-10-15T09:00:00.000Z'), goodRow('desktop', '2026-10-15T09:00:00.000Z'));
    const res = await POST(req('POST'), ctx(ORG));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, anyOk: true, keyConfigured: true });
    expect(googleUrls.map((u) => u.searchParams.get('strategy')).sort()).toEqual(['desktop', 'mobile']);
    expect(googleUrls.every((u) => u.searchParams.get('key') === KEY && u.searchParams.get('url') === 'https://www.example.com')).toBe(true);
    expect(db.tables.org_website_audits).toHaveLength(4);
    expect(body.latest.mobile.fetchedAt).toBe('2026-10-16T12:00:00.000Z');
    expect(JSON.stringify(body)).not.toContain(KEY);

    const audit = db.tables.admin_audit_log;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ admin_user_id: 'bo-1', action: 'website_health_forced', subject_type: 'org', subject_id: ORG });
    expect(audit[0].detail).toEqual({ orgName: 'zz-test-site-A', website: 'https://www.example.com', results: [{ strategy: 'mobile', ok: true, error: null }, { strategy: 'desktop', ok: true, error: null }], keyConfigured: true });
  });

  it('when Google refuses (the key is set, the quota is used up), the refusal is stored and reported to the admin as it is (anyOk:false) — and still audited', async () => {
    google = () => new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
    const body = await json(await POST(req('POST'), ctx(ORG)));
    expect(body).toMatchObject({ ok: true, anyOk: false, keyConfigured: true });
    expect(body.latest.mobile).toMatchObject({ ok: false, error: { kind: 'quota', httpStatus: 429 } });
    expect(googleUrls.every((u) => u.searchParams.get('key') === KEY)).toBe(true);
    expect(db.tables.admin_audit_log[0].detail).toMatchObject({ keyConfigured: true, results: [{ ok: false, error: 'quota' }, { ok: false, error: 'quota' }] });
  });

  // Prompt 919 addendum (19/10/2026) — no key is not a "quota" the admin can retry later; nothing can ever succeed, so nothing is sent.
  it.each(['', '  '])('without a key (%j) a forced check is refused with the instruction: 503, Google is not asked, nothing is stored, nothing is audited', async (key) => {
    vi.stubEnv('PAGESPEED_API_KEY', key);
    const res = await POST(req('POST'), ctx(ORG));
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body).toMatchObject({ ok: false, keyConfigured: false });
    expect(body.error).toContain('PAGESPEED_API_KEY is not set on this deployment');
    expect(body.error).toContain('CONFIG_REGISTRY.md §1.4b');
    expect(googleUrls).toEqual([]);
    expect(db.writes).toEqual([]);
    expect(db.tables.admin_audit_log).toEqual([]);
  });

  it('a startup with no website on file: 400, Google not asked, no audit row', async () => {
    db.tables.orgs[0].website = null;
    const res = await POST(req('POST'), ctx(ORG));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('This startup has no website on file.');
    expect(googleUrls).toEqual([]);
    expect(db.tables.admin_audit_log).toEqual([]);
  });

  it('a website that is not a public address: 400', async () => {
    db.tables.orgs[0].website = 'http://localhost:3000';
    expect((await POST(req('POST'), ctx(ORG))).status).toBe(400);
    expect(googleUrls).toEqual([]);
  });

  it('a startup that does not exist: 404', async () => {
    expect((await POST(req('POST'), ctx('b0b0b0b0-0000-4000-8000-00000000000b'))).status).toBe(404);
    expect(googleUrls).toEqual([]);
  });

  it('the migration is not applied: 503', async () => {
    h.available = false;
    expect((await POST(req('POST'), ctx(ORG))).status).toBe(503);
    expect(googleUrls).toEqual([]);
  });

  it('it never touches the wallet or a model: a forced check is a free Google call', async () => {
    await POST(req('POST'), ctx(ORG));
    expect(db.rpcCalls?.some((c) => c.name === 'charge_ai_action')).toBe(false);
    expect(db.tables.ai_credit_charges ?? []).toEqual([]);
  });
});
