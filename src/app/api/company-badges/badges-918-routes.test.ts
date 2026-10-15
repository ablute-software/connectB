// Prompt 918 — the routes behind the badges, over an in-memory database (fixtures named zz-test-*):
//  · what a founder can and cannot write (the verdict is never theirs; a logo is only ever their own org's file; a source must be a public address);
//  · the verification's order — THE CHARGE FIRST, then the page, then the model — and what a refusal (402), an already-verified badge, a broken link
//    or a missing API key cost: nothing, and run: nothing;
//  · the two logo routes: the founder's (own org, including a Developer Viewer's VIEWED org) and the investor's (verified badge, eligible investor, org open).
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { VIEWER_ORG_COOKIE } from '@/lib/developer-viewer-shape';

const h = vi.hoisted(() => ({ session: null as unknown, admin: null as unknown, order: [] as string[] }));

vi.mock('@/lib/supabase-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => h.session,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));
vi.mock('@/lib/badge-logo-proxy', () => ({
  serveBadgeLogo: vi.fn(async () => new Response('logo-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } })),
}));
vi.mock('@/lib/ai-credits', () => ({ chargeAiAction: vi.fn() }));
vi.mock('@/lib/ai-cost-log', () => ({ logAiCall: vi.fn(async () => {}), computeCostEur: () => 0 }));
vi.mock('@/lib/public-fetch', () => ({ fetchSourcePage: vi.fn(), publicImageOk: vi.fn() }));
vi.mock('@/lib/investor-pipeline', () => ({ resolveInvestorOrgEligibility: vi.fn() }));
vi.mock('@/lib/org-closed', () => ({ closedOrgGuard: vi.fn(async () => null) }));

import { serveBadgeLogo } from '@/lib/badge-logo-proxy';
import { chargeAiAction } from '@/lib/ai-credits';
import { logAiCall } from '@/lib/ai-cost-log';
import { fetchSourcePage, publicImageOk } from '@/lib/public-fetch';
import { resolveInvestorOrgEligibility } from '@/lib/investor-pipeline';
import { closedOrgGuard } from '@/lib/org-closed';
import { POST as createBadge } from './route';
import { PATCH as editBadge } from './[id]/route';
import { POST as verifyBadge } from './[id]/verify/route';
import { GET as founderLogo } from './[id]/logo/route';
import { GET as investorLogo } from '../portal/badge-logo/[badgeId]/route';

const ORG_A = 'a0a0a0a0-0000-4000-8000-00000000000a'; // zz-test-A
const ORG_B = 'b0b0b0b0-0000-4000-8000-00000000000b'; // zz-test-B
const USER_A = 'dddddddd-0000-4000-8000-00000000000a';
const USER_B = 'dddddddd-0000-4000-8000-00000000000b';
const ENTERED = '2026-10-15T10:00:00.000Z';
const cookieFor = (org: string) => `${VIEWER_ORG_COOKIE}=${org}:${ENTERED}`;

const charge = vi.mocked(chargeAiAction);
const serve = vi.mocked(serveBadgeLogo);
const fetchPage = vi.mocked(fetchSourcePage);
const imageOk = vi.mocked(publicImageOk);
const eligibility = vi.mocked(resolveInvestorOrgEligibility);
const closedGuard = vi.mocked(closedOrgGuard);
const modelFetch = vi.fn();

function badge(over: Record<string, unknown>) {
  return {
    org_id: ORG_A, description: null, year: 2023, kind: 'award', verification_status: 'unverified', verification_note: null, verified_at: null,
    source_url: null, source_title: null, source_found_by: null, logo_storage_path: null, logo_url: null, evidence_document_id: null, linked_claim_id: null,
    created_at: '2026-10-14T10:00:00Z', ...over,
  };
}

let db: FakeDb;
function world(): FakeDb {
  const d = fakeDb({
    orgs: [{ id: ORG_A, name: 'zz-test-A' }, { id: ORG_B, name: 'zz-test-B' }],
    org_members: [{ user_id: USER_A, org_id: ORG_A, role: 'owner' }, { user_id: USER_B, org_id: ORG_B, role: 'owner' }],
    company_badges: [
      badge({ id: 'bdg-verified', name: 'zz-test-A verified', verification_status: 'verified', verified_at: '2026-10-14T10:51:46.58Z', source_url: 'https://www.altice.pt/premios/2023', source_title: 'Altice winners', source_found_by: 'sherlock', logo_url: 'https://cdn.altice.pt/logo.png' }),
      badge({ id: 'bdg-unverified', name: 'zz-test-A unverified', year: 2025, kind: 'programme', source_url: 'https://www.altice.pt/premios/2023', logo_storage_path: `${ORG_A}/uuid-logo.png` }),
      badge({ id: 'bdg-nolink', name: 'zz-test-A no link', year: 2024 }),
      badge({ id: 'bdg-badlink', name: 'zz-test-A bad link', source_url: 'javascript:alert(1)' }),
      badge({ id: 'bdg-B', org_id: ORG_B, name: 'zz-test-B badge', source_url: 'https://example.pt/b' }),
    ],
    admin_audit_log: [],
    ai_call_log: [],
  });
  d.applyWrites = true;
  return d;
}

function actAs(user: string, isDeveloper = false) {
  h.session = fakeSession(db, { userId: user, isDeveloper, email: `${user}@example.test` });
  h.admin = fakeAdmin(db);
}
function call(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): NextRequest {
  return new NextRequest(`https://example.test${url}`, {
    method, headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
const ctx = (id: string) => ({ params: { id } });
const inserts = () => db.writes.filter((w) => w.table === 'company_badges' && w.op === 'insert');
const updates = () => db.writes.filter((w) => w.table === 'company_badges' && w.op === 'update');
const row = (id: string) => (db.tables.company_badges as Record<string, unknown>[]).find((r) => r.id === id)!;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
  vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test-key');
  h.order = [];
  db = world();
  actAs(USER_A);
  serve.mockClear();
  charge.mockReset(); fetchPage.mockReset(); imageOk.mockReset(); eligibility.mockReset(); closedGuard.mockReset(); closedGuard.mockResolvedValue(null);
  vi.mocked(logAiCall).mockClear();
  modelFetch.mockReset();
  vi.stubGlobal('fetch', modelFetch);
});

describe('POST /api/company-badges — a founder records a claim; the verdict is never theirs', () => {
  it('creates it private (unverified), with its kind and the link the founder gave, marked as the founder\'s', async () => {
    const res = await createBadge(call('POST', '/api/company-badges', { body: { name: 'zz-test-A new', year: 2024, kind: 'programme', sourceUrl: 'altice.pt/premios', skipDuplicateCheck: true } }));
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].values).toMatchObject({ org_id: ORG_A, name: 'zz-test-A new', year: 2024, kind: 'programme', source_url: 'https://altice.pt/premios', source_found_by: 'founder' });
  });

  it('writes none of the verdict\'s fields even when the body carries them', async () => {
    await createBadge(call('POST', '/api/company-badges', {
      body: {
        name: 'zz-test-A sneaky', skipDuplicateCheck: true,
        verificationStatus: 'verified', verification_status: 'verified', verified_at: '2026-10-15T00:00:00Z', verification_note: 'trust me',
        source_title: 'T', logo_url: 'https://evil.example/pixel.png', sourceFoundBy: 'sherlock', source_found_by: 'sherlock',
      },
    }));
    expect(inserts()).toHaveLength(1);
    const keys = Object.keys(inserts()[0].values as object);
    for (const forbidden of ['verification_status', 'verified_at', 'verification_note', 'source_title', 'logo_url']) expect(keys, forbidden).not.toContain(forbidden);
    expect((inserts()[0].values as Record<string, unknown>).source_found_by).toBeNull();
  });

  it('refuses a source that is not a public web address, and a logo that is not this org\'s own file — and writes nothing', async () => {
    for (const body of [
      { name: 'x', sourceUrl: 'javascript:alert(1)' }, { name: 'x', sourceUrl: 'http://localhost/a' }, { name: 'x', sourceUrl: 'https://10.0.0.5/a' },
      { name: 'x', logoStoragePath: `${ORG_B}/secret.png` }, { name: 'x', logoStoragePath: `${ORG_A}/../${ORG_B}/secret.png` },
    ]) {
      const res = await createBadge(call('POST', '/api/company-badges', { body: { ...body, skipDuplicateCheck: true } }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(inserts()).toEqual([]);
  });

  it('accepts a logo that is the org\'s own upload', async () => {
    const res = await createBadge(call('POST', '/api/company-badges', { body: { name: 'zz-test-A logo', logoStoragePath: `${ORG_A}/uuid-logo.png`, skipDuplicateCheck: true } }));
    expect(res.status).toBe(200);
    expect(inserts()[0].values).toMatchObject({ logo_storage_path: `${ORG_A}/uuid-logo.png` });
  });
});

describe('PATCH /api/company-badges/[id] — an edit that changes what was verified takes the badge back to private', () => {
  it('renaming a verified badge: back to unverified, no date, no found title or logo, and the answer says so', async () => {
    const res = await editBadge(call('PATCH', '/api/company-badges/bdg-verified', { body: { name: 'zz-test-A verified (renamed)' } }), ctx('bdg-verified'));
    expect(await res.json()).toMatchObject({ ok: true, resetsVerification: true });
    expect(updates()[0].values).toMatchObject({
      name: 'zz-test-A verified (renamed)', verification_status: 'unverified', verified_at: null,
      verification_note: 'Edited — verify again to show it to investors', source_title: null, logo_url: null,
    });
  });

  it('the form resends the same link and a new description: nothing about the verification changes, and a link Sherlock found stays Sherlock\'s', async () => {
    const res = await editBadge(call('PATCH', '/api/company-badges/bdg-verified', {
      body: { name: 'zz-test-A verified', year: 2023, sourceUrl: 'https://www.altice.pt/premios/2023', description: 'new', kind: 'award' },
    }), ctx('bdg-verified'));
    expect(await res.json()).toMatchObject({ ok: true, resetsVerification: false });
    const values = updates()[0].values as Record<string, unknown>;
    expect(values).toMatchObject({ description: 'new', kind: 'award' });
    for (const k of ['verification_status', 'verified_at', 'verification_note', 'source_url', 'source_found_by', 'source_title', 'logo_url']) expect(Object.keys(values), k).not.toContain(k);
  });

  it('never takes a verdict from the body', async () => {
    await editBadge(call('PATCH', '/api/company-badges/bdg-unverified', {
      body: { description: 'x', verification_status: 'verified', verificationStatus: 'verified', verified_at: '2026-10-15T00:00:00Z', verification_note: 'trust me', source_title: 'T', logo_url: 'https://evil.example/p.png' },
    }), ctx('bdg-unverified'));
    expect(updates()[0].values).toEqual({ description: 'x' });
  });

  it('refuses a broken link and a logo outside the org\'s folder; clearing the link clears it', async () => {
    expect((await editBadge(call('PATCH', '/x', { body: { sourceUrl: 'ftp://x.example/a' } }), ctx('bdg-unverified'))).status).toBe(400);
    expect((await editBadge(call('PATCH', '/x', { body: { logoStoragePath: `${ORG_B}/secret.png` } }), ctx('bdg-unverified'))).status).toBe(400);
    expect(updates()).toEqual([]);
    const res = await editBadge(call('PATCH', '/x', { body: { sourceUrl: '' } }), ctx('bdg-unverified'));
    expect(res.status).toBe(200);
    expect(updates()[0].values).toMatchObject({ source_url: null, source_found_by: null });
  });

  it('another org\'s badge is not found', async () => {
    const res = await editBadge(call('PATCH', '/x', { body: { description: 'x' } }), ctx('bdg-B'));
    expect(res.status).toBe(404);
    expect(updates()).toEqual([]);
  });
});

describe('POST /api/company-badges/[id]/verify — the charge comes first, and a refusal costs nothing and runs nothing', () => {
  const MODEL_OK = {
    content: [{ type: 'tool_use', name: 'report_verification', input: {
      found_credible_confirmation: true, found_contradiction: false, note: 'Won the Inclui category.',
      source_url: 'https://www.altice.pt/premios/2023', source_title: 'Altice winners 2023', logo_url: 'https://www.altice.pt/logo.png',
    } }],
    usage: { input_tokens: 1200, output_tokens: 80 },
  };
  const PAGE_OK = {
    ok: true as const, finalUrl: 'https://www.altice.pt/premios/2023',
    html: '<html><head><title>Altice winners 2023</title><meta property="og:image" content="https://www.altice.pt/logo.png"></head><body><p>Mob2is won the Inclui category.</p></body></html>',
  };
  const wire = () => {
    charge.mockImplementation(async () => { h.order.push('charge'); return { ok: true, reason: null, used: 5, monthlyLimit: 80, remaining: 75, resetAt: null }; });
    fetchPage.mockImplementation(async () => { h.order.push('page'); return PAGE_OK; });
    imageOk.mockResolvedValue(true);
    modelFetch.mockImplementation(async () => { h.order.push('model'); return new Response(JSON.stringify(MODEL_OK), { status: 200, headers: { 'content-type': 'application/json' } }); });
  };

  it('charges badge_verification BEFORE it reads the page or calls the model; then verifies with the source, its title and a checked logo', async () => {
    wire();
    const res = await verifyBadge(call('POST', '/x'), ctx('bdg-unverified'));
    expect(await res.json()).toMatchObject({ ok: true, configured: true, status: 'verified' });
    expect(h.order).toEqual(['charge', 'page', 'model']);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0][1]).toBe(ORG_A);
    expect(charge.mock.calls[0][2]).toBe('badge_verification');
    expect(updates()).toHaveLength(1);
    expect(updates()[0].values).toMatchObject({
      verification_status: 'verified', source_url: 'https://www.altice.pt/premios/2023', source_found_by: 'founder',
      source_title: 'Altice winners 2023', logo_url: 'https://www.altice.pt/logo.png',
    });
    expect((updates()[0].values as Record<string, unknown>).verified_at).toEqual(expect.any(String));
    expect(logAiCall).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'badge_verification', orgId: ORG_A }));
  });

  it('the model is asked with one web search when the founder\'s page was read, and the page text is inside the request as untrusted content', async () => {
    wire();
    await verifyBadge(call('POST', '/x'), ctx('bdg-unverified'));
    const [url, init] = modelFetch.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('anthropic-test-key');
    const body = JSON.parse(init.body) as { tools: { name: string; max_uses?: number }[]; messages: { content: { text?: string }[] }[] };
    expect(body.tools.find((t) => t.name === 'web_search')?.max_uses).toBe(1);
    expect(JSON.stringify(body.messages)).toContain('Mob2is won the Inclui category.');
  });

  it('three web searches when there is no link to read', async () => {
    wire();
    await verifyBadge(call('POST', '/x'), ctx('bdg-nolink'));
    const body = JSON.parse((modelFetch.mock.calls[0] as [string, { body: string }])[1].body) as { tools: { name: string; max_uses?: number }[] };
    expect(body.tools.find((t) => t.name === 'web_search')?.max_uses).toBe(3);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('with the wallet at zero: 402, the wallet\'s own words, and NOTHING ran — no page, no model, no write', async () => {
    charge.mockImplementation(async () => { h.order.push('charge'); return { ok: false, reason: 'AI credits limit reached (80 of 80 this month).', used: 80, monthlyLimit: 80, remaining: 0, resetAt: null }; });
    const res = await verifyBadge(call('POST', '/x'), ctx('bdg-unverified'));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ ok: false, insufficientCredits: true, error: 'AI credits limit reached (80 of 80 this month).' });
    expect(h.order).toEqual(['charge']);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(modelFetch).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect(logAiCall).not.toHaveBeenCalled();
  });

  it('a wallet that cannot be read refuses too (fails closed) — never an unmetered model call', async () => {
    charge.mockResolvedValue({ ok: false, reason: 'Couldn\'t verify your AI credit balance — please try again in a moment.', used: 0, monthlyLimit: null, remaining: null, resetAt: null });
    const res = await verifyBadge(call('POST', '/x'), ctx('bdg-unverified'));
    expect(res.status).toBe(402);
    expect(modelFetch).not.toHaveBeenCalled();
  });

  it('what cannot run costs nothing: an already-verified badge (409), a broken link (400), no API key, another org\'s badge (404)', async () => {
    const verified = await verifyBadge(call('POST', '/x'), ctx('bdg-verified'));
    expect(verified.status).toBe(409);
    expect((await verified.json()).error).toMatch(/already verified/);
    expect((await verifyBadge(call('POST', '/x'), ctx('bdg-badlink'))).status).toBe(400);
    expect((await verifyBadge(call('POST', '/x'), ctx('bdg-B'))).status).toBe(404);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const noKey = await verifyBadge(call('POST', '/x'), ctx('bdg-unverified'));
    expect(await noKey.json()).toMatchObject({ ok: true, configured: false });
    expect(charge).not.toHaveBeenCalled();
    expect(modelFetch).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
  });

  it('a confirmation the model cannot back with a public source stays private, with the note that tells the founder what to do', async () => {
    wire();
    modelFetch.mockImplementation(async () => {
      h.order.push('model');
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'report_verification', input: { found_credible_confirmation: true, found_contradiction: false, note: 'Seen on a forum.', source_url: 'https://invented.example/nothing' } }], usage: {} }), { status: 200 });
    });
    const res = await verifyBadge(call('POST', '/x'), ctx('bdg-nolink'));
    expect(await res.json()).toMatchObject({ ok: true, status: 'unverified', note: 'Confirmed in search but no stable public source — add a link' });
    expect(updates()[0].values).toMatchObject({ verification_status: 'unverified', verified_at: null });
    expect(Object.keys(updates()[0].values as object)).not.toContain('source_url');
  });

  it('a provider error is a 502 with nothing stored', async () => {
    wire();
    modelFetch.mockImplementation(async () => new Response('{"error":{"message":"overloaded"}}', { status: 529 }));
    const res = await verifyBadge(call('POST', '/x'), ctx('bdg-unverified'));
    expect(res.status).toBe(502);
    expect(updates()).toEqual([]);
  });
});

describe('GET /api/company-badges/[id]/logo — the founder\'s own route', () => {
  it('serves the logo of the founder\'s own badge, whatever its state', async () => {
    const res = await founderLogo(call('GET', '/api/company-badges/bdg-unverified/logo'), ctx('bdg-unverified'));
    expect(res.status).toBe(200);
    expect(serve).toHaveBeenCalledTimes(1);
    expect(serve.mock.calls[0][0].badge).toEqual({ org_id: ORG_A, logo_storage_path: `${ORG_A}/uuid-logo.png`, logo_url: null });
  });

  it('another org\'s badge is not found, and nothing is served', async () => {
    const res = await founderLogo(call('GET', '/api/company-badges/bdg-B/logo'), ctx('bdg-B'));
    expect(res.status).toBe(404);
    expect(serve).not.toHaveBeenCalled();
  });

  it('a Developer Viewer sees the VIEWED org\'s logo and not their own org\'s: B\'s member viewing A gets A\'s badge, A\'s member viewing B does not get A\'s', async () => {
    actAs(USER_B, true);
    const ok = await founderLogo(call('GET', '/x', { cookie: cookieFor(ORG_A) }), ctx('bdg-verified'));
    expect(ok.status).toBe(200);
    expect(serve.mock.calls[0][0].badge.org_id).toBe(ORG_A);
    expect(db.writes.filter((w) => w.table !== 'admin_audit_log')).toEqual([]);

    serve.mockClear();
    actAs(USER_A, true);
    const none = await founderLogo(call('GET', '/x', { cookie: cookieFor(ORG_B) }), ctx('bdg-verified'));
    expect(none.status).toBe(404);
    expect(serve).not.toHaveBeenCalled();
  });
});

describe('GET /api/portal/badge-logo/[badgeId] — the investor\'s route', () => {
  const params = (badgeId: string) => ({ params: { badgeId } });
  const eligible = () => eligibility.mockResolvedValue({ eligible: true, decision: null, investorCatalogEntityId: 'ce-1' } as never);

  it('needs a signed-in investor', async () => {
    h.session = { auth: { getUser: async () => ({ data: { user: null } }) } };
    const res = await investorLogo(call('GET', '/x'), params('bdg-verified'));
    expect(res.status).toBe(401);
    expect(serve).not.toHaveBeenCalled();
  });

  it('serves the logo of a VERIFIED badge to an investor linked to the startup', async () => {
    eligible();
    const res = await investorLogo(call('GET', '/x'), params('bdg-verified'));
    expect(res.status).toBe(200);
    expect(serve).toHaveBeenCalledTimes(1);
    expect(serve.mock.calls[0][0].badge).toEqual({ org_id: ORG_A, logo_storage_path: null, logo_url: 'https://cdn.altice.pt/logo.png' });
    expect(eligibility.mock.calls[0][3]).toBe(ORG_A);
  });

  it('an unverified badge\'s logo is as private as the badge: 404, and the investor is not even looked up', async () => {
    eligible();
    for (const id of ['bdg-unverified', 'bdg-nolink', 'bdg-badlink', 'does-not-exist']) {
      const res = await investorLogo(call('GET', '/x'), params(id));
      expect(res.status, id).toBe(404);
    }
    expect(serve).not.toHaveBeenCalled();
    expect(eligibility).not.toHaveBeenCalled();
  });

  it('a "verified" row with no source or no date (the table refuses to hold one) is not served either', async () => {
    eligible();
    row('bdg-verified').source_url = null;
    expect((await investorLogo(call('GET', '/x'), params('bdg-verified'))).status).toBe(404);
    row('bdg-verified').source_url = 'https://www.altice.pt/premios/2023';
    row('bdg-verified').verified_at = null;
    expect((await investorLogo(call('GET', '/x'), params('bdg-verified'))).status).toBe(404);
    expect(serve).not.toHaveBeenCalled();
  });

  it('an investor with no relationship to the startup gets the same 404 as for an id that does not exist', async () => {
    eligibility.mockResolvedValue({ eligible: false, decision: null, investorCatalogEntityId: null } as never);
    const res = await investorLogo(call('GET', '/x'), params('bdg-verified'));
    expect(res.status).toBe(404);
    expect(serve).not.toHaveBeenCalled();
  });

  it('a closed org answers with the closed-org guard and serves nothing', async () => {
    eligible();
    closedGuard.mockResolvedValue(new Response('{"ok":false,"reason":"closed"}', { status: 410 }) as never);
    const res = await investorLogo(call('GET', '/x'), params('bdg-verified'));
    expect(res.status).toBe(410);
    expect(serve).not.toHaveBeenCalled();
  });
});
