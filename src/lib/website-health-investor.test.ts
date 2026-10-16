// Prompt 919 D — what reaches an INVESTOR, proved at the three places it could go wrong:
//   1. projectDossier: the block exists only when handed one, and is rebuilt field by field (a caller cannot smuggle a summary through it);
//   2. fetchDossierRawData: the founder's switch is read BEFORE any score is queried (off ⇒ the table is never touched), the query selects
//      the four scores and nothing else (never `audits`, never `summary`), and the scores must be the CURRENT website's;
//   3. the founder's own "see how investors see this profile" route — the same fetch + projection a real investor gets — end to end.
// Fixtures are named zz-test-*. The summary text and the finding titles below are SENTINELS: they sit on the very row the dossier reads, so
// if any path were to carry them out, the JSON would contain them.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeAdmin, fakeDb, fakeSession, type FakeDb } from '@/test/fake-supabase';
import { projectDossier, type FullDossierData } from './investor-interest-level';
import { fetchDossierRawData } from './dossier-fetch';
import { INVESTOR_AUDIT_COLUMNS, pageSpeedReportUrl, type WebsiteHealthPublic } from './website-health';

const h = vi.hoisted(() => ({ available: true, session: null as unknown, admin: null as unknown }));
vi.mock('@/lib/website-health-capability', () => ({ websiteHealthAvailable: async () => h.available }));
vi.mock('@/lib/supabase-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  authEnabled: true,
  serverClient: async () => h.session,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.admin }));

const ORG = 'a0a0a0a0-0000-4000-8000-00000000000a';
const FOUNDER = 'f0f0f0f0-0000-4000-8000-00000000000a';
const SUMMARY_SENTINEL = 'zz-test-SUMMARY-SENTINEL-too-much-javascript';
const FINDING_SENTINEL = 'zz-test-FINDING-SENTINEL-reduce-javascript-execution-time';
const URL_ = 'https://www.example.com';
const AT = '2026-10-12T09:30:00.000Z';

const FULL: FullDossierData = {
  overview: { description: 'A startup.', sectors: ['health'], stage: 'seed', foundedYear: 2024, hqCity: 'Lisbon', country: 'PT', roundTargetEur: 1000000, roundValuationEur: null, roundValuationBasis: null, roundMinTicketEur: null, roundInstruments: [] },
  tractionDetailed: {}, team: [], contactHistory: [], documentTitles: [],
} as unknown as FullDossierData;

const PUBLIC: WebsiteHealthPublic = { scores: { performance: 61, seo: 85, accessibility: 82, bestPractices: 96 }, strategy: 'mobile', checkedAt: AT, reportUrl: pageSpeedReportUrl(URL_, 'mobile') };

describe('projectDossier — the block is there only when it is handed one', () => {
  it('nothing handed (the switch is off, or no analysis): no key at all at any level — not even an empty "not shared" line', () => {
    for (const level of [0, 1, 2, 3] as const) {
      for (const wh of [undefined, null]) {
        const out = projectDossier(level, FULL, false, null, null, null, null, null, null, wh);
        expect('websiteHealth' in out, `level ${level} ${String(wh)}`).toBe(false);
      }
    }
  });

  it('handed one: it is there at EVERY level (a public measurement the founder chose to show, not a level-gated disclosure)', () => {
    for (const level of [0, 1, 2, 3] as const) {
      const out = projectDossier(level, FULL, false, null, null, null, null, null, null, PUBLIC);
      expect(out.websiteHealth, `level ${level}`).toEqual(PUBLIC);
    }
  });

  it('is rebuilt field by field: a summary, findings, a verdict or a colour smuggled onto the object cannot come out', () => {
    const smuggled = { ...PUBLIC, summary: SUMMARY_SENTINEL, audits: [{ title: FINDING_SENTINEL }], findings: [FINDING_SENTINEL], verdict: 'poor', band: 'red', color: '#B00000', scores: { ...PUBLIC.scores, average: 81, grade: 'B' } } as unknown as WebsiteHealthPublic;
    const out = projectDossier(3, FULL, false, null, null, null, null, null, null, smuggled);
    expect(Object.keys(out.websiteHealth as object).sort()).toEqual(['checkedAt', 'reportUrl', 'scores', 'strategy']);
    expect(Object.keys((out.websiteHealth as WebsiteHealthPublic).scores).sort()).toEqual(['accessibility', 'bestPractices', 'performance', 'seo']);
    const flat = JSON.stringify(out);
    for (const leak of [SUMMARY_SENTINEL, FINDING_SENTINEL, 'poor', 'verdict', '#B00000', 'grade', 'average']) expect(flat).not.toContain(leak);
  });
});

// ─── fetchDossierRawData ───────────────────────────────────────────────────────────────────────────────────
let db: FakeDb;
let selects: { table: string; cols: string }[];

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r-m', org_id: ORG, url: URL_, strategy: 'mobile', fetched_at: AT,
  score_performance: 61, score_seo: 85, score_accessibility: 82, score_best_practices: 96,
  lcp_ms: 1243, cls: '0.0011', inp_ms: null,
  audits: { items: [{ id: 'bootup-time', title: FINDING_SENTINEL, description: 'x', displayValue: '1.2 s', weight: 1 }] },
  summary: JSON.stringify({ v: 1, headline: SUMMARY_SENTINEL, fixFirst: [], doingWell: [] }), summary_model: 'claude-haiku-4-5', summary_credits: 2,
  ...over,
});

function world(over: { visible?: boolean | null; website?: string | null; rows?: Record<string, unknown>[] } = {}): FakeDb {
  return fakeDb({
    orgs: [{ id: ORG, name: 'zz-test-investor-view', website: over.website === undefined ? `${URL_}/` : over.website, website_score_visible: over.visible === undefined ? true : over.visible,
      swot_visible_to_investors: false, roadmap_visible_to_investors: false, market_groups_visible_to_investors: [] }],
    org_members: [{ user_id: FOUNDER, org_id: ORG, role: 'admin' }],
    org_website_audits: over.rows ?? [row(), row({ id: 'r-d', strategy: 'desktop', score_performance: 100 })],
    company_badges: [], matchdeal_profiles: [], company_people: [], documents: [],
  });
}

/** An admin client that records every select list, so a test can say what was asked of which table. */
function spied(d: FakeDb): SupabaseClient {
  const admin = fakeAdmin(d) as unknown as { from: (t: string) => Record<string, unknown> };
  return { ...admin, from: (table: string) => {
    const b = admin.from(table);
    const select = b.select as (c?: string, o?: unknown) => unknown;
    b.select = (cols?: string, o?: unknown) => { selects.push({ table, cols: cols ?? '' }); return select(cols, o); };
    return b;
  } } as unknown as SupabaseClient;
}
const auditSelects = () => selects.filter((s) => s.table === 'org_website_audits');

beforeEach(() => {
  h.available = true;
  selects = [];
  db = world();
});

describe('fetchDossierRawData — websiteHealth', () => {
  it('switch ON + a complete mobile analysis of the current website: the four scores, the date and Google\'s report — and nothing else', async () => {
    const raw = await fetchDossierRawData(spied(db), ORG, 0, null);
    expect(raw.websiteHealth).toEqual(PUBLIC);
    expect(raw.websiteHealth!.reportUrl).toBe('https://pagespeed.web.dev/report?url=https%3A%2F%2Fwww.example.com&form_factor=mobile');
  });

  it('the query lists the four scores, the address and the date — NEVER `audits`, NEVER `summary` (so neither can leak from here)', async () => {
    await fetchDossierRawData(spied(db), ORG, 3, null);
    const q = auditSelects();
    expect(q).toHaveLength(1);
    expect(q[0].cols).toBe(INVESTOR_AUDIT_COLUMNS);
    expect(q[0].cols).not.toMatch(/audits|summary|lcp|cls|inp|org_id|id,/);
    const raw = await fetchDossierRawData(spied(db), ORG, 3, null);
    const flat = JSON.stringify(raw.websiteHealth);
    expect(flat).not.toContain(SUMMARY_SENTINEL);
    expect(flat).not.toContain(FINDING_SENTINEL);
  });

  it('switch OFF: the analyses are NEVER QUERIED — nothing is fetched and hidden afterwards (the same rule as round progress)', async () => {
    for (const visible of [false, null]) {
      selects = [];
      db = world({ visible });
      const raw = await fetchDossierRawData(spied(db), ORG, 3, null);
      expect(raw.websiteHealth, String(visible)).toBeNull();
      expect(auditSelects(), String(visible)).toEqual([]);
    }
  });

  it('the migration is not applied: null, and neither the flag nor the table is read', async () => {
    h.available = false;
    const raw = await fetchDossierRawData(spied(db), ORG, 3, null);
    expect(raw.websiteHealth).toBeNull();
    expect(auditSelects()).toEqual([]);
    expect(selects.some((s) => s.cols.includes('website_score_visible'))).toBe(false);
  });

  it('scores measured on ANOTHER address are not the company\'s now: after a change of website nothing is shared until a new check', async () => {
    db = world({ website: 'https://new-site.com' });
    expect((await fetchDossierRawData(spied(db), ORG, 3, null)).websiteHealth).toBeNull();
  });

  it('no website on file: null', async () => {
    for (const website of [null, '', '   ']) {
      db = world({ website });
      expect((await fetchDossierRawData(spied(db), ORG, 3, null)).websiteHealth, String(website)).toBeNull();
    }
  });

  it('only a FAILED analysis (no scores): null — the investor never sees a half-empty block', async () => {
    db = world({ rows: [row({ score_performance: null, score_seo: null, score_accessibility: null, score_best_practices: null, audits: { error: { kind: 'quota', message: 'x' } }, summary: null })] });
    expect((await fetchDossierRawData(spied(db), ORG, 3, null)).websiteHealth).toBeNull();
  });

  it('a partial analysis (one score missing): null', async () => {
    db = world({ rows: [row({ score_seo: null })] });
    expect((await fetchDossierRawData(spied(db), ORG, 3, null)).websiteHealth).toBeNull();
  });

  it('only a DESKTOP analysis exists: null — the investor block is the phone reading, always', async () => {
    db = world({ rows: [row({ id: 'r-d', strategy: 'desktop' })] });
    expect((await fetchDossierRawData(spied(db), ORG, 3, null)).websiteHealth).toBeNull();
  });

  it('an analysis of the right address but with an impossible score is not shared', async () => {
    db = world({ rows: [row({ score_performance: 140 })] });
    expect((await fetchDossierRawData(spied(db), ORG, 3, null)).websiteHealth).toBeNull();
  });
});

// ─── the founder's "see how investors see this profile" route (the same fetch + projection as a real investor's) ─────────────
describe('GET /api/settings/dossier-preview — what the founder sees is what the investor gets', () => {
  const call = (level: number) => new NextRequest(`https://example.test/api/settings/dossier-preview?level=${level}`);
  async function preview(level: number) {
    const { GET } = await import('@/app/api/settings/dossier-preview/route');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
    h.session = fakeSession(db, { userId: FOUNDER, isDeveloper: false, email: 'founder@example.test' });
    h.admin = fakeAdmin(db);
    const res = await GET(call(level));
    expect(res.status).toBe(200);
    return (await res.json()) as { ok: boolean; dossier: Record<string, unknown> };
  }

  it('switch ON: the investor view carries the four numbers, the date and the report — and not one word of the summary or the findings', async () => {
    for (const level of [0, 3]) {
      const body = await preview(level);
      expect(body.ok).toBe(true);
      expect(body.dossier.websiteHealth, `level ${level}`).toEqual(PUBLIC);
      const flat = JSON.stringify(body);
      expect(flat).not.toContain(SUMMARY_SENTINEL);
      expect(flat).not.toContain(FINDING_SENTINEL);
    }
  });

  it('switch OFF: no block at all — the key is absent (the page then draws nothing, not "not shared")', async () => {
    db = world({ visible: false });
    for (const level of [0, 3]) {
      const body = await preview(level);
      expect('websiteHealth' in body.dossier, `level ${level}`).toBe(false);
      expect(JSON.stringify(body)).not.toContain('pagespeed');
    }
  });
});
