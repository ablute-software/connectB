// Prompt 919 C — what the founder's card is given. Pure, so proved on stored rows built the way the check route stores them
// (successRow / failureRow over the real Lighthouse fixtures).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { failureRow, reducePageSpeedResponse, successRow, type StoredRowLike, type WebsiteStrategy } from './website-health';
import { buildFounderState, FOUNDER_ROW_COLUMNS } from './website-health-state';
import { serializeSummary, type WebsiteSummary } from './website-health-summary';

const fixture = (n: string) => JSON.parse(readFileSync(path.resolve(__dirname, `__fixtures__/${n}`), 'utf8')) as unknown;
const reduced = (n: string) => { const r = reducePageSpeedResponse({ lighthouseResult: fixture(n) }); if (!r.ok) throw new Error('fixture must reduce'); return r.analysis; };
const HEAVY = reduced('pagespeed-heavy-mobile.json');
const EXAMPLE = reduced('pagespeed-example-mobile.json');
const NOW = new Date('2026-10-16T12:00:00.000Z');
const AT = '2026-10-14T09:30:00.000Z';
const URL_ = 'https://example.com';

const ok = (strategy: WebsiteStrategy, a = HEAVY, url = URL_, at = AT, extra: Partial<StoredRowLike> = {}): StoredRowLike => ({ ...successRow('o', url, strategy, a, at), ...extra }) as StoredRowLike;
const bad = (strategy: WebsiteStrategy, kind: 'unreachable' | 'quota' | 'key' = 'unreachable', url = URL_, at = AT): StoredRowLike =>
  failureRow('o', url, strategy, { kind, message: 'RAW GOOGLE TEXT — back office only', httpStatus: 500 }, at) as StoredRowLike;

const SUMMARY: WebsiteSummary = {
  v: 1, headline: 'Your site is usable but slow on a phone.',
  fixFirst: [{ auditIds: ['bootup-time'], what: 'Too much JavaScript runs on load.', whyItMatters: 'Visitors wait.', how: 'Delay non-essential scripts.' }],
  doingWell: [{ category: 'best-practices', text: 'Safe habits.' }],
};

describe('buildFounderState', () => {
  it('no website on file: nothing to analyse, and the allowance says why', () => {
    for (const website of [null, undefined, '', '   ']) {
      const s = buildFounderState({ website, visible: false, rows: [], now: NOW });
      expect(s).toMatchObject({ ok: true, available: true, website: null, websiteProblem: 'missing', summary: null, summaryOffered: false, allowance: { allowed: false, reason: 'no_website' } });
      expect(s.analyses).toEqual({ mobile: null, desktop: null });
    }
  });

  it('an address that is not a public website is "invalid", not "missing"', () => {
    const s = buildFounderState({ website: 'http://localhost:3000', visible: false, rows: [], now: NOW });
    expect(s).toMatchObject({ website: null, websiteProblem: 'invalid', allowance: { allowed: false, reason: 'no_website' } });
  });

  it('a website with no check yet: allowed to check, nothing shown, no summary offered', () => {
    const s = buildFounderState({ website: 'Example.com/', visible: false, rows: [], now: NOW });
    expect(s).toMatchObject({ website: URL_, websiteProblem: 'none', allowance: { allowed: true }, summary: null, summaryOffered: false, summaryStrategy: null });
  });

  it('two good analyses: both views, the phone one is the one a summary is offered for, the date and the 7-day window are right', () => {
    const s = buildFounderState({ website: URL_, visible: false, rows: [ok('mobile'), ok('desktop', EXAMPLE)], now: NOW });
    expect(s.analyses.mobile).toMatchObject({ strategy: 'mobile', url: URL_, fetchedAt: AT, scores: { performance: 61, seo: 85, accessibility: 82, bestPractices: 96 }, error: null });
    expect(s.analyses.desktop?.scores).toEqual({ performance: 100, seo: 80, accessibility: 96, bestPractices: 100 });
    expect(s.analyses.mobile?.metrics).toEqual({ lcpMs: 1243, cls: 0.0011, inpMs: null });
    expect(s.analyses.mobile?.findings).toHaveLength(13);
    expect(s.analyses.mobile?.reportUrl).toBe('https://pagespeed.web.dev/report?url=https%3A%2F%2Fexample.com&form_factor=mobile');
    expect(s.analyses.desktop?.reportUrl).toContain('form_factor=desktop');
    expect(s.summaryStrategy).toBe('mobile');
    expect(s.summaryOffered).toBe(true);
    expect(s.allowance).toEqual({ allowed: false, reason: 'too_soon', nextCheckAt: '2026-10-21T09:30:00.000Z' });
  });

  it('numeric(8,4) comes back from Postgres as a STRING: cls is read as a number', () => {
    const s = buildFounderState({ website: URL_, visible: false, rows: [ok('mobile', HEAVY, URL_, AT, { cls: '0.0011' })], now: NOW });
    expect(s.analyses.mobile?.metrics.cls).toBe(0.0011);
  });

  it('a stored summary is parsed and replaces the offer; it is read from the phone row', () => {
    const rows = [ok('mobile', HEAVY, URL_, AT, { summary: serializeSummary(SUMMARY), summary_model: 'claude-haiku-4-5', summary_credits: 2 }), ok('desktop', EXAMPLE)];
    const s = buildFounderState({ website: URL_, visible: false, rows, now: NOW });
    expect(s.summary).toEqual(SUMMARY);
    expect(s.summaryOffered).toBe(false);
    expect(s.summaryStrategy).toBe('mobile');
  });

  it('a summary that cannot be read (corrupted, or from a future shape) is treated as no summary, never shown half-parsed', () => {
    for (const summary of ['not json', '{"v":2,"headline":"x"}', '{"v":1}', '']) {
      const s = buildFounderState({ website: URL_, visible: false, rows: [ok('mobile', HEAVY, URL_, AT, { summary })], now: NOW });
      expect(s.summary, summary).toBeNull();
      expect(s.summaryOffered, summary).toBe(true);
    }
  });

  it('phone failed, desktop worked: the summary belongs to (and is offered for) the desktop analysis', () => {
    const s = buildFounderState({ website: URL_, visible: false, rows: [bad('mobile'), ok('desktop', EXAMPLE)], now: NOW });
    expect(s.summaryStrategy).toBe('desktop');
    expect(s.summaryOffered).toBe(true);
    expect(s.analyses.mobile).toMatchObject({ scores: { performance: null }, error: { kind: 'unreachable', copy: "Google couldn't analyse this URL — check it loads publicly" } });
  });

  it('both failed: the card has nothing to summarise, and says the founder-safe sentence — never Google\'s raw text', () => {
    const s = buildFounderState({ website: URL_, visible: false, rows: [bad('mobile', 'quota'), bad('desktop', 'quota')], now: NOW });
    expect(s.summaryOffered).toBe(false);
    expect(s.summaryStrategy).toBeNull();
    expect(s.analyses.mobile?.error?.copy).toBe("Google's free quota for this check is used up right now. Try again later.");
    expect(JSON.stringify(s)).not.toContain('RAW GOOGLE TEXT');
  });

  it('a failed check does not burn the week: only the short cooldown applies', () => {
    const s = buildFounderState({ website: URL_, visible: false, rows: [bad('mobile', 'unreachable', URL_, '2026-10-16T11:55:00.000Z'), bad('desktop', 'unreachable', URL_, '2026-10-16T11:55:00.000Z')], now: NOW });
    expect(s.allowance).toEqual({ allowed: false, reason: 'cooldown', nextCheckAt: '2026-10-16T12:05:00.000Z' });
    const later = buildFounderState({ website: URL_, visible: false, rows: [bad('mobile', 'unreachable', URL_, '2026-10-16T09:00:00.000Z')], now: NOW });
    expect(later.allowance).toEqual({ allowed: true });
  });

  it('scores measured on ANOTHER address are not this website\'s: after a change of website the card starts clean and a check is allowed at once', () => {
    const old = [ok('mobile', HEAVY, 'https://old-site.example'), ok('desktop', EXAMPLE, 'https://old-site.example')];
    const s = buildFounderState({ website: URL_, visible: true, rows: old, now: NOW });
    expect(s.analyses).toEqual({ mobile: null, desktop: null });
    expect(s.summary).toBeNull();
    expect(s.summaryOffered).toBe(false);
    expect(s.allowance).toEqual({ allowed: true });
  });

  it('the newest row of each strategy wins', () => {
    const older = ok('mobile', EXAMPLE, URL_, '2026-09-01T10:00:00.000Z');
    const newer = ok('mobile', HEAVY, URL_, AT);
    const s = buildFounderState({ website: URL_, visible: false, rows: [older, newer], now: NOW });
    expect(s.analyses.mobile?.fetchedAt).toBe(AT);
    expect(s.analyses.mobile?.scores.performance).toBe(61);
  });

  it('the switch is ON only for an explicit true (null, undefined and anything else are off)', () => {
    for (const [visible, want] of [[true, true], [false, false], [null, false], [undefined, false]] as const) {
      expect(buildFounderState({ website: URL_, visible, rows: [], now: NOW }).visibleToInvestors).toBe(want);
    }
  });

  it('what the card carries has no AI raw output and no other org\'s data: only the parsed summary and the views', () => {
    const rows = [ok('mobile', HEAVY, URL_, AT, { summary: serializeSummary(SUMMARY), summary_model: 'claude-haiku-4-5', summary_credits: 2, id: 'row-id' })];
    const flat = JSON.stringify(buildFounderState({ website: URL_, visible: true, rows, now: NOW }));
    expect(flat).not.toContain('claude-haiku-4-5');
    expect(flat).not.toContain('row-id');
    expect(flat).not.toContain('"org_id"');
  });
});

describe('FOUNDER_ROW_COLUMNS', () => {
  it('selects what the card shows and not org_id; it does select audits + summary (the founder\'s own)', () => {
    const cols = FOUNDER_ROW_COLUMNS.split(',').map((c) => c.trim());
    expect(cols).toEqual(expect.arrayContaining(['url', 'strategy', 'fetched_at', 'audits', 'summary', 'score_performance', 'score_seo', 'score_accessibility', 'score_best_practices']));
    expect(cols).not.toContain('org_id');
  });
});
