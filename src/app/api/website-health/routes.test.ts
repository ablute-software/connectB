// Prompt 919 — the founder-side routes of website health, through their REAL handlers (withActingOrg, the real Google client and reducer, the
// real wallet call) over an in-memory database. Only the two network edges are stubbed: Google's PageSpeed API answers with the real
// Lighthouse fixtures, and the Anthropic API answers as told. The things the prompt calls out are proved here:
//   · the Google analysis is FREE — a check never touches the wallet, and is limited to one per org per 7 days;
//   · the summary charges BEFORE the model; with an empty wallet it answers 402, calls nothing, and leaves the analysis exactly as it was;
//   · the key is sent to Google and never comes back; a Developer Viewer session reads the VIEWED org's card and writes nothing.
// Fixtures are named zz-test-*, as CLAUDE.md asks of anything that models a real org.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer-shape';
import { readStoredSummary } from '@/lib/website-health-summary';

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown, available: true }));
vi.mock('@/lib/supabase-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => h.session,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
// The capability probe has its own tests (capability-probe.ts); here it is a switch for "the migration is applied / is not".
vi.mock('@/lib/website-health-capability', () => ({ websiteHealthAvailable: async () => h.available }));

import { GET } from './route';
import { POST as check, maxDuration as checkMaxDuration } from './check/route';
import { POST as summary, maxDuration as summaryMaxDuration } from './summary/route';
import { POST as visibility } from './visibility/route';

const ORG_A = 'a0a0a0a0-0000-4000-8000-00000000000a'; // zz-test-site-A — a website on file
const ORG_B = 'b0b0b0b0-0000-4000-8000-00000000000b'; // zz-test-site-B — none
const FOUNDER = 'f0f0f0f0-0000-4000-8000-00000000000a';
const DEV = 'dddddddd-0000-4000-8000-00000000000b';
const KEY = 'AIzaSyTESTONLYabcdefghijklmnopqrstuvwx';
const T0 = new Date('2026-10-16T12:00:00.000Z');
const ENTERED = '2026-10-16T11:00:00.000Z';

const fixture = (n: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../../lib/__fixtures__/${n}`), 'utf8')) as unknown;
const KEYLESS_BODY = JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'pagespeedonline.googleapis.com' for consumer 'project_number:583797351490'.", status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded', domain: 'global' }], details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED', metadata: { quota_limit_value: '0' } }] } });

const GOOD_TOOL_USE = {
  type: 'tool_use', name: 'report_website_summary',
  input: {
    headline: 'Your site is usable but slow to respond on a phone.',
    fix_first: [{ audit_ids: ['bootup-time'], what: 'Too much JavaScript runs on load.', why_it_matters: 'Visitors wait before they can tap.', how: 'Ask your developer to delay non-essential scripts.' }],
    doing_well: [{ category: 'best-practices', text: 'The site follows the safe habits browsers expect.' }],
  },
};

// ─── the world ─────────────────────────────────────────────────────────────────────────────────────────────
let db: FakeDb;
let order: string[];                       // what happened, in order: 'charge', 'google:mobile', 'model' …
let googleUrls: URL[];
let anthropicBodies: Record<string, unknown>[];
let google: (u: URL) => Response;
let anthropic: (body: Record<string, unknown>) => Response;
let wallet: () => { ok: boolean; reason: string | null };
let errors: ReturnType<typeof vi.spyOn>;

const googleOk = (u: URL) => new Response(JSON.stringify({ lighthouseResult: fixture(u.searchParams.get('strategy') === 'mobile' ? 'pagespeed-heavy-mobile.json' : 'pagespeed-example-mobile.json') }), { status: 200 });
const anthropicOk = () => new Response(JSON.stringify({ content: [GOOD_TOOL_USE], usage: { input_tokens: 1800, output_tokens: 220 } }), { status: 200 });

function world(): FakeDb {
  const d = fakeDb({
    orgs: [
      { id: ORG_A, name: 'zz-test-site-A', website: 'https://www.example.com/', website_score_visible: false },
      { id: ORG_B, name: 'zz-test-site-B', website: null, website_score_visible: true },
    ],
    org_members: [{ user_id: FOUNDER, org_id: ORG_A, role: 'admin' }, { user_id: DEV, org_id: ORG_B, role: 'admin' }],
    org_website_audits: [],
    ai_credit_charges: [],
    ai_call_log: [],
    admin_audit_log: [],
  });
  d.applyWrites = true;
  d.rpc = {
    // the wallet's own function: refuses or charges 2 credits, and records the charge the way the real one does
    charge_ai_action: (args) => {
      order.push('charge');
      const a = args as { p_org_id: string; p_action_key: string };
      const r = wallet();
      if (r.ok) d.tables.ai_credit_charges.push({ org_id: a.p_org_id, action_key: a.p_action_key, credits_charged: 2, created_at: new Date().toISOString() });
      return [{ ok: r.ok, reason: r.reason, used: r.ok ? 2 : 80, monthly_limit: 80, remaining: r.ok ? 78 : 0, reset_at: null }];
    },
  };
  return d;
}

function actAs(user: string, isDeveloper = false) {
  h.session = fakeSession(db, { userId: user, isDeveloper, email: `${user}@example.test` });
  h.admin = fakeAdmin(db);
}

function call(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): NextRequest {
  return new NextRequest(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
const viewing = (org: string) => `${VIEWER_ORG_COOKIE}=${org}:${ENTERED}`;
const rowsOf = () => db.tables.org_website_audits;
const auditRows = () => db.writes.filter((w) => w.table === 'admin_audit_log');
const dataWrites = () => db.writes.filter((w) => w.table !== 'admin_audit_log');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
  vi.stubEnv('PAGESPEED_API_KEY', KEY);
  vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');
  h.available = true;
  order = []; googleUrls = []; anthropicBodies = [];
  google = googleOk; anthropic = anthropicOk; wallet = () => ({ ok: true, reason: null });
  db = world();
  actAs(FOUNDER);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const u = new URL(typeof input === 'string' ? input : input.toString());
    if (u.hostname === 'www.googleapis.com') { googleUrls.push(u); order.push(`google:${u.searchParams.get('strategy')}`); return google(u); }
    if (u.hostname === 'api.anthropic.com') { order.push('model'); const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; anthropicBodies.push(body); return anthropic(body); }
    throw new Error(`unexpected network call to ${u.hostname}`);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); errors.mockRestore(); });

const json = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the functions live within a Hobby plan\'s 60 seconds', () => {
  it('check and summary declare maxDuration 60', () => {
    expect(checkMaxDuration).toBe(60);
    expect(summaryMaxDuration).toBe(60);
  });
});

describe('GET /api/website-health — the card\'s state (read-only)', () => {
  it('before any check: the website on file (normalised), nothing analysed, a check is allowed — and nothing is called or written', async () => {
    const body = await json(await GET(call('GET', '/api/website-health')));
    expect(body).toMatchObject({ ok: true, available: true, website: 'https://www.example.com', websiteProblem: 'none', visibleToInvestors: false, summary: null, summaryOffered: false, allowance: { allowed: true } });
    expect(body.analyses).toEqual({ mobile: null, desktop: null });
    expect(googleUrls).toEqual([]);
    expect(db.writes).toEqual([]);
    expect(order).toEqual([]);
  });

  it('no website on file: the card is told so', async () => {
    actAs(DEV);
    const body = await json(await GET(call('GET', '/api/website-health')));
    expect(body).toMatchObject({ ok: true, website: null, websiteProblem: 'missing', allowance: { allowed: false, reason: 'no_website' } });
  });

  it('the migration is not applied yet: the card does not appear (available:false) and the database is not even asked', async () => {
    h.available = false;
    expect(await json(await GET(call('GET', '/api/website-health')))).toEqual({ ok: true, available: false });
    expect(db.writes).toEqual([]);
  });

  it('a Developer Viewer session reads the VIEWED org\'s card, writes nothing but its audit row, and never starts a check', async () => {
    rowsOf().push({ id: 'r1', org_id: ORG_A, url: 'https://www.example.com', strategy: 'mobile', fetched_at: '2026-10-14T09:00:00.000Z', score_performance: 61, score_seo: 85, score_accessibility: 82, score_best_practices: 96, lcp_ms: 1243, cls: '0.0011', inp_ms: null, audits: { items: [] }, summary: null });
    actAs(DEV, true); // DEV's own org is B; the cookie says "look at A"
    const viewA = await json(await GET(call('GET', '/api/website-health', { cookie: viewing(ORG_A) })));
    expect(viewA.website).toBe('https://www.example.com');
    expect(viewA.analyses.mobile.scores.performance).toBe(61);
    expect(dataWrites()).toEqual([]);
    expect(auditRows().map((w) => (w.values as { action: string }).action)).toEqual(['viewer_read']);
    expect(googleUrls).toEqual([]);

    // and the other way round: a member of A, viewing B, sees nothing of A
    actAs(FOUNDER, true);
    const viewB = await json(await GET(call('GET', '/api/website-health', { cookie: viewing(ORG_B) })));
    expect(JSON.stringify(viewB)).not.toContain('example.com');
    expect(viewB.analyses).toEqual({ mobile: null, desktop: null });
  });
});

describe('POST /api/website-health/check — free, once per 7 days, always stores something true', () => {
  it('asks Google for the phone AND the desktop analysis of the normalised address, with the key; stores both; costs nothing', async () => {
    const res = await check(call('POST', '/api/website-health/check'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(googleUrls.map((u) => u.searchParams.get('strategy')).sort()).toEqual(['desktop', 'mobile']);
    for (const u of googleUrls) {
      expect(u.searchParams.get('url')).toBe('https://www.example.com');
      expect(u.searchParams.getAll('category')).toEqual(['performance', 'seo', 'accessibility', 'best-practices']);
      expect(u.searchParams.get('key')).toBe(KEY);
    }
    expect(rowsOf()).toHaveLength(2);
    expect(rowsOf().every((r) => r.org_id === ORG_A && r.url === 'https://www.example.com' && r.fetched_at === T0.toISOString())).toBe(true);
    expect(body.analyses.mobile.scores).toEqual({ performance: 61, seo: 85, accessibility: 82, bestPractices: 96 });
    expect(body.analyses.desktop.scores).toEqual({ performance: 100, seo: 80, accessibility: 96, bestPractices: 100 });
    expect(body.checked).toEqual({ anyOk: true, results: [{ strategy: 'mobile', ok: true }, { strategy: 'desktop', ok: true }] });
    expect(body.summaryOffered).toBe(true);
    expect(body.allowance).toEqual({ allowed: false, reason: 'too_soon', nextCheckAt: '2026-10-23T12:00:00.000Z' });
    // free: the wallet was never touched and the model never called
    expect(db.rpcCalls?.some((c) => c.name === 'charge_ai_action')).toBe(false);
    expect(order).not.toContain('charge');
    expect(order).not.toContain('model');
    expect(db.tables.ai_credit_charges).toEqual([]);
  });

  it('the key goes to Google and never comes back: not in the response, not in what is stored', async () => {
    const res = await check(call('POST', '/api/website-health/check'));
    expect(JSON.stringify(await res.json())).not.toContain(KEY);
    expect(JSON.stringify(rowsOf())).not.toContain(KEY);
  });

  it('without a key configured the request carries none (Google then answers quota; the back office sees the key is missing)', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '');
    google = () => new Response(KEYLESS_BODY, { status: 429 });
    await check(call('POST', '/api/website-health/check'));
    expect(googleUrls.every((u) => !u.searchParams.has('key'))).toBe(true);
  });

  it('one analysis per org per 7 days: the second attempt is refused with the date, Google is not asked again, nothing is stored; after 7 days it runs', async () => {
    expect((await check(call('POST', '/api/website-health/check'))).status).toBe(200);
    expect(googleUrls).toHaveLength(2);

    vi.setSystemTime(new Date('2026-10-20T08:00:00.000Z'));
    const again = await check(call('POST', '/api/website-health/check'));
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ ok: false, reason: 'too_soon', nextCheckAt: '2026-10-23T12:00:00.000Z', error: 'Your last check is still current. You can check again on 23 Oct.' });
    expect(googleUrls).toHaveLength(2);
    expect(rowsOf()).toHaveLength(2);

    vi.setSystemTime(new Date('2026-10-23T12:00:01.000Z'));
    expect((await check(call('POST', '/api/website-health/check'))).status).toBe(200);
    expect(googleUrls).toHaveLength(4);
    expect(rowsOf()).toHaveLength(4);
  });

  it('a founder who fixes the address gets a check at once: the 7 days belong to the address that was measured', async () => {
    await check(call('POST', '/api/website-health/check'));
    db.tables.orgs.find((o) => o.id === ORG_A)!.website = 'https://new-site.com';
    const res = await check(call('POST', '/api/website-health/check'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.website).toBe('https://new-site.com');
    expect(body.analyses.mobile.url).toBe('https://new-site.com'); // the old site's scores are not shown as the new one's
  });

  it('no website on file: 400, and Google is never asked', async () => {
    actAs(DEV);
    const res = await check(call('POST', '/api/website-health/check'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'no_website', error: 'Add your website in About › Company to run this check.' });
    expect(googleUrls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('an address that is not a public website (localhost) is refused before Google sees it', async () => {
    db.tables.orgs.find((o) => o.id === ORG_A)!.website = 'http://localhost:3000';
    const res = await check(call('POST', '/api/website-health/check'));
    expect(res.status).toBe(400);
    expect((await json(res)).reason).toBe('invalid_website');
    expect(googleUrls).toEqual([]);
  });

  it('when Google refuses (no key / quota), a row per strategy says so — the card has something true to show — and the logs say it is OURS to fix', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '');
    google = () => new Response(KEYLESS_BODY, { status: 429 });
    const res = await check(call('POST', '/api/website-health/check'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.checked.anyOk).toBe(false);
    expect(rowsOf()).toHaveLength(2);
    expect(rowsOf().every((r) => r.score_performance === null && (r.audits as { error: { kind: string } }).error.kind === 'quota')).toBe(true);
    expect(body.analyses.mobile.error).toEqual({ kind: 'quota', copy: "Google's free quota for this check is used up right now. Try again later." });
    expect(JSON.stringify(body)).not.toContain('Quota exceeded for quota metric'); // Google's raw text is for the back office
    expect(errors).toHaveBeenCalledWith('[website-health] PageSpeed refused', expect.objectContaining({ orgId: ORG_A, kind: 'quota', httpStatus: 429, keyConfigured: false }));
    // …and a failed attempt does not burn the week: only a short cooldown
    const retry = await check(call('POST', '/api/website-health/check'));
    expect(retry.status).toBe(429);
    expect((await json(retry)).reason).toBe('cooldown');
  });

  it('a site Google could not load is the FOUNDER\'S to fix: the card says "check it loads publicly", and it is not logged as our fault', async () => {
    google = () => new Response(JSON.stringify({ error: { code: 500, message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Lighthouse was unable to reliably load the page you requested.', status: 'INTERNAL' } }), { status: 500 });
    const body = await json(await check(call('POST', '/api/website-health/check')));
    expect(body.analyses.mobile.error.copy).toBe("Google couldn't analyse this URL — check it loads publicly");
    expect(errors).not.toHaveBeenCalledWith('[website-health] PageSpeed refused', expect.anything());
  });

  it('a storage failure is reported, not swallowed', async () => {
    const real = h.admin as { from: (t: string) => unknown };
    h.admin = { ...real, from: (t: string) => (t === 'org_website_audits' ? { ...(real.from(t) as object), insert: () => ({ then: (r: (v: unknown) => unknown) => r({ data: null, error: { message: 'disk full' } }) }) } : real.from(t)), rpc: (h.admin as { rpc: unknown }).rpc };
    const res = await check(call('POST', '/api/website-health/check'));
    expect(res.status).toBe(500);
    expect((await json(res)).error).toBe('The check ran but could not be saved. Try again.');
  });

  it('the migration is not applied: 503, nothing asked, nothing written', async () => {
    h.available = false;
    const res = await check(call('POST', '/api/website-health/check'));
    expect(res.status).toBe(503);
    expect(googleUrls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('a Developer Viewer session cannot start a check: 403 viewer_read_only, Google is not asked, nothing is written', async () => {
    actAs(DEV, true);
    const res = await check(call('POST', '/api/website-health/check', { cookie: viewing(ORG_A) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'viewer_read_only' });
    expect(googleUrls).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});

describe('POST /api/website-health/summary — the only charged part, the wallet first', () => {
  const freshAnalysis = async () => { await check(call('POST', '/api/website-health/check')); order = []; googleUrls = []; db.writes.length = 0; };
  const snapshot = () => JSON.stringify(rowsOf());

  it('no analysis on file: 400, and NOTHING is charged', async () => {
    const res = await summary(call('POST', '/api/website-health/summary'));
    expect(res.status).toBe(400);
    expect(order).toEqual([]);
    expect(db.tables.ai_credit_charges).toEqual([]);
  });

  it('charges BEFORE the model, asks the cheapest model for the grounded tool, stores the summary on the phone analysis, logs the call', async () => {
    await freshAnalysis();
    const res = await summary(call('POST', '/api/website-health/summary'));
    expect(res.status).toBe(200);
    expect(order).toEqual(['charge', 'model']);
    expect(db.rpcCalls?.find((c) => c.name === 'charge_ai_action')?.args).toEqual({ p_org_id: ORG_A, p_action_key: 'website_summary' });

    expect(anthropicBodies).toHaveLength(1);
    const sent = anthropicBodies[0] as { model: string; max_tokens: number; tool_choice: { name: string }; messages: { content: string }[] };
    expect(sent.model).toBe('claude-haiku-4-5');
    expect(sent.tool_choice.name).toBe('report_website_summary');
    const prompt = JSON.stringify(sent.messages);
    expect(prompt).toContain('bootup-time');                      // a failed audit of the heavy phone page
    expect(prompt).toContain('61');                               // the four scores travel
    expect(prompt).not.toContain('zz-test-site-A');               // the org's name does not
    expect(prompt).not.toContain(KEY);

    const mobile = rowsOf().find((r) => r.strategy === 'mobile')!;
    expect(rowsOf().find((r) => r.strategy === 'desktop')!.summary ?? null).toBeNull();
    expect(mobile.summary_model).toBe('claude-haiku-4-5');
    expect(mobile.summary_credits).toBe(2);
    expect(readStoredSummary(mobile.summary as string)?.headline).toBe('Your site is usable but slow to respond on a phone.');

    const body = await json(res);
    expect(body.summary.fixFirst[0].auditIds).toEqual(['bootup-time']);
    expect(body.summaryOffered).toBe(false);

    const log = db.tables.ai_call_log;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ route: '/api/website-health/summary', purpose: 'website_summary', model: 'claude-haiku-4-5', org_id: ORG_A, tokens_in: 1800, tokens_out: 220 });
  });

  it('a summary that already exists is returned, never charged again', async () => {
    await freshAnalysis();
    await summary(call('POST', '/api/website-health/summary'));
    order = [];
    const again = await json(await summary(call('POST', '/api/website-health/summary')));
    expect(again.alreadyDone).toBe(true);
    expect(again.summary.headline).toBeTruthy();
    expect(order).toEqual([]);
    expect(db.tables.ai_credit_charges).toHaveLength(1);
  });

  it('an EMPTY wallet: 402 insufficientCredits, the wallet\'s own sentence — the model is never called, nothing is written, the analysis is exactly as it was and the button stays', async () => {
    await freshAnalysis();
    wallet = () => ({ ok: false, reason: 'AI credits limit reached (80 of 80 this month).' });
    const before = snapshot();
    const res = await summary(call('POST', '/api/website-health/summary'));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ ok: false, error: 'AI credits limit reached (80 of 80 this month).', insufficientCredits: true });
    expect(order).toEqual(['charge']);                          // the wallet was asked; nothing after it ran
    expect(anthropicBodies).toEqual([]);
    expect(dataWrites()).toEqual([]);
    expect(db.tables.ai_call_log).toEqual([]);
    expect(snapshot()).toBe(before);

    const card = await json(await GET(call('GET', '/api/website-health')));
    expect(card.analyses.mobile.scores).toEqual({ performance: 61, seo: 85, accessibility: 82, bestPractices: 96 });
    expect(card).toMatchObject({ summary: null, summaryOffered: true }); // "Get the summary (2 credits)" is still offered
  });

  it('an unavailable wallet (its RPC failing) fails CLOSED: no model call', async () => {
    await freshAnalysis();
    const real = h.session as { rpc: (n: string, a?: unknown) => Promise<unknown> };
    h.session = { ...real, rpc: async (n: string, a?: unknown) => (n === 'charge_ai_action' ? { data: null, error: { message: 'down' } } : real.rpc(n, a)), auth: (h.session as { auth: unknown }).auth, from: (h.session as { from: unknown }).from };
    const res = await summary(call('POST', '/api/website-health/summary'));
    expect(res.status).toBe(402);
    expect(anthropicBodies).toEqual([]);
  });

  it('no Anthropic key on this deployment: told so, and NOTHING is charged', async () => {
    await freshAnalysis();
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const body = await json(await summary(call('POST', '/api/website-health/summary')));
    expect(body).toMatchObject({ ok: true, configured: false });
    expect(order).toEqual([]);
  });

  it('a model answer with nothing usable: 502, says the scores are untouched, nothing stored (the credits are spent — no refund mechanism exists)', async () => {
    await freshAnalysis();
    anthropic = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'I cannot.' }], usage: { input_tokens: 10, output_tokens: 3 } }), { status: 200 });
    const before = snapshot();
    const res = await summary(call('POST', '/api/website-health/summary'));
    expect(res.status).toBe(502);
    expect((await json(res)).error).toContain('Your scores are untouched');
    expect(order).toEqual(['charge', 'model']);
    expect(snapshot()).toBe(before);
  });

  it('the provider failing after the charge: 502 and nothing stored', async () => {
    await freshAnalysis();
    anthropic = () => new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 });
    const before = snapshot();
    const res = await summary(call('POST', '/api/website-health/summary'));
    expect(res.status).toBe(502);
    expect(snapshot()).toBe(before);
  });

  it('an answer that cites an audit Google never reported keeps the headline and drops the invented fix', async () => {
    await freshAnalysis();
    anthropic = () => new Response(JSON.stringify({ content: [{ ...GOOD_TOOL_USE, input: { ...GOOD_TOOL_USE.input, fix_first: [{ audit_ids: ['made-up-audit'], what: 'x', why_it_matters: 'y', how: 'z' }] } }], usage: {} }), { status: 200 });
    const body = await json(await summary(call('POST', '/api/website-health/summary')));
    expect(body.summary.headline).toBeTruthy();
    expect(body.summary.fixFirst).toEqual([]);
  });

  it('a Developer Viewer session cannot spend the viewed org\'s credits: 403, no charge, no model', async () => {
    await freshAnalysis();
    actAs(DEV, true);
    const res = await summary(call('POST', '/api/website-health/summary', { cookie: viewing(ORG_A) }));
    expect(res.status).toBe(403);
    expect(order).toEqual([]);
    expect(db.tables.ai_credit_charges).toEqual([]);
  });

  it('the migration is not applied: 503 and nothing charged', async () => {
    h.available = false;
    expect((await summary(call('POST', '/api/website-health/summary'))).status).toBe(503);
    expect(order).toEqual([]);
  });
});

describe('POST /api/website-health/visibility — "Show my website health score to investors"', () => {
  it('writes the founder\'s own org only, and a boolean only', async () => {
    const res = await visibility(call('POST', '/api/website-health/visibility', { body: { visible: true } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, visibleToInvestors: true });
    expect(db.tables.orgs.find((o) => o.id === ORG_A)!.website_score_visible).toBe(true);
    expect(db.tables.orgs.find((o) => o.id === ORG_B)!.website_score_visible).toBe(true); // B was already true in the fixture; the write did not touch it
    expect(db.writes).toEqual([{ table: 'orgs', op: 'update', values: { website_score_visible: true }, eqs: [['id', ORG_A]] }]);
    expect((await json(await GET(call('GET', '/api/website-health')))).visibleToInvestors).toBe(true);

    await visibility(call('POST', '/api/website-health/visibility', { body: { visible: false } }));
    expect(db.tables.orgs.find((o) => o.id === ORG_A)!.website_score_visible).toBe(false);
  });

  it('anything that is not exactly true/false is refused and nothing is written', async () => {
    for (const body of [{}, { visible: 'yes' }, { visible: 1 }, { visible: null }, { visible: 'true' }]) {
      const res = await visibility(call('POST', '/api/website-health/visibility', { body }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.writes).toEqual([]);
  });

  it('a Developer Viewer session cannot flip a founder\'s switch', async () => {
    actAs(DEV, true);
    const res = await visibility(call('POST', '/api/website-health/visibility', { cookie: viewing(ORG_A), body: { visible: true } }));
    expect(res.status).toBe(403);
    expect(db.tables.orgs.find((o) => o.id === ORG_A)!.website_score_visible).toBe(false);
    expect(db.writes).toEqual([]);
  });

  it('the migration is not applied: 503 (the column is not there to write)', async () => {
    h.available = false;
    expect((await visibility(call('POST', '/api/website-health/visibility', { body: { visible: true } }))).status).toBe(503);
    expect(db.writes).toEqual([]);
  });
});
