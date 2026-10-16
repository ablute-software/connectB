// Prompt 919 — the rules of website health, proved on REAL Lighthouse 13.5.0 results (src/lib/__fixtures__/pagespeed-*.json: the real
// values of a public light page and a public heavy one; the heavy one's host is anonymised). Where a rule exists because the real data
// contradicts an assumption (a 100-score page with "failed" insight audits, savings in three different places, an audit shared by two
// categories, a non-breaking space inside every display value), the test says so.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BAND_COLOR, FAILED_RETRY_MINUTES, PERF_MAX_FINDINGS, RECHECK_DAYS, checkAllowance, classifyPageSpeedHttpError, failureRow, formatCheckedDate,
  hasScores, isFailedAudit, latestByStrategy, normalizeWebsiteUrl, pageSpeedReportUrl, parseLighthouseText, parseSavingsBytes,
  performanceSavings, primaryRow, projectWebsiteHealthForInvestor, readStoredAudits, reducePageSpeedResponse, scoreBand, successRow,
  websiteCheckErrorCopy, websiteDomain, type ReduceResult, type StoredRowLike,
} from './website-health';

const fixture = (name: string) => JSON.parse(readFileSync(path.resolve(__dirname, `__fixtures__/${name}`), 'utf8')) as {
  categories: Record<string, unknown>; audits: Record<string, Record<string, unknown>>; fetchTime: string; lighthouseVersion: string;
};
const EXAMPLE = fixture('pagespeed-example-mobile.json');
const HEAVY = fixture('pagespeed-heavy-mobile.json');
// the PageSpeed v5 answer wraps the Lighthouse result
const wrap = (lh: unknown, extra: Record<string, unknown> = {}) => ({ kind: 'pagespeedonline#result', analysisUTCTimestamp: '2026-10-16T14:46:00.000Z', lighthouseResult: lh, ...extra });
const ok = (r: ReduceResult) => { if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`); return r.analysis; };

describe('normalizeWebsiteUrl — the address a check runs against', () => {
  it('gives https and no trailing slash, whatever the founder typed', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('  https://Example.com/  ')).toBe('https://example.com');
    expect(normalizeWebsiteUrl('http://www.ablute.pt/')).toBe('https://www.ablute.pt');
    expect(normalizeWebsiteUrl('https://example.com/en/')).toBe('https://example.com/en');
    expect(normalizeWebsiteUrl('https://example.com/pt?ref=x#team')).toBe('https://example.com/pt?ref=x');
  });
  it('refuses what is not a public website: credentials, IP literals, one-label and private names, odd ports, other schemes, nonsense', () => {
    for (const bad of [
      '', '   ', null, undefined, 42, 'javascript:alert(1)', 'ftp://example.com', 'https://user:pw@example.com', 'https://10.0.0.5', 'https://[::1]/', 'http://localhost:3000',
      'https://intranet', 'https://printer.local', 'https://site.internal', 'https://example.com:8443', 'not a url', `https://example.com/${'a'.repeat(2001)}`,
      // the names RFC 2606 reserves can never be loaded by Google — refused before they reach the quota
      'https://site.test', 'https://new-site.example', 'https://nothing.invalid', 'https://app.localhost',
    ]) expect(normalizeWebsiteUrl(bad), String(bad)).toBeNull();
  });
  it('builds Google\'s own report link and a readable domain', () => {
    expect(pageSpeedReportUrl('https://example.com/en', 'mobile')).toBe('https://pagespeed.web.dev/report?url=https%3A%2F%2Fexample.com%2Fen&form_factor=mobile');
    expect(pageSpeedReportUrl('https://example.com', 'desktop')).toContain('form_factor=desktop');
    expect(websiteDomain('https://www.example.com/en')).toBe('example.com');
    expect(websiteDomain(null)).toBeNull();
  });
});

describe('scoreBand — Google\'s scale', () => {
  it('0–49 red, 50–89 orange, 90–100 green, at the boundaries', () => {
    expect([0, 49].map(scoreBand)).toEqual(['red', 'red']);
    expect([50, 89].map(scoreBand)).toEqual(['orange', 'orange']);
    expect([90, 100].map(scoreBand)).toEqual(['green', 'green']);
    expect(Object.keys(BAND_COLOR)).toEqual(['red', 'orange', 'green']);
  });
});

describe('isFailedAudit — on every audit of both real results', () => {
  it('informative, manual, not-applicable and error audits are NEVER failures (an `error` is Google failing to measure, not a site failing)', () => {
    for (const lh of [EXAMPLE, HEAVY]) {
      for (const a of Object.values(lh.audits)) {
        if (['informative', 'manual', 'notApplicable', 'error'].includes(a.scoreDisplayMode as string)) expect(isFailedAudit(a), String(a.id)).toBe(false);
      }
    }
    expect(Object.values(EXAMPLE.audits).filter((a) => a.scoreDisplayMode === 'error').map((a) => a.id)).toEqual(['document-latency-insight', 'server-response-time']);
  });
  it('binary fails below 1, numeric and metricSavings below 0.9 (Google\'s own pass line); a null score never fails', () => {
    expect(isFailedAudit({ score: 0, scoreDisplayMode: 'binary' })).toBe(true);
    expect(isFailedAudit({ score: 1, scoreDisplayMode: 'binary' })).toBe(false);
    expect(isFailedAudit({ score: 0.89, scoreDisplayMode: 'numeric' })).toBe(true);
    expect(isFailedAudit({ score: 0.9, scoreDisplayMode: 'numeric' })).toBe(false);
    expect(isFailedAudit({ score: 0.5, scoreDisplayMode: 'metricSavings' })).toBe(true);
    expect(isFailedAudit({ score: null, scoreDisplayMode: 'binary' })).toBe(false);
    expect(isFailedAudit(undefined)).toBe(false);
  });
});

describe('parseSavingsBytes / performanceSavings — savings live in three different places', () => {
  it('reads the number out of Lighthouse\'s display text, which separates the unit with a NON-BREAKING space', () => {
    expect(parseSavingsBytes('Est savings of 1,687 KiB')).toBe(1687 * 1024);
    expect(parseSavingsBytes('Est savings of 41 KiB')).toBe(41 * 1024);
    expect(parseSavingsBytes('Est savings of 2.5 MiB')).toBe(Math.round(2.5 * 1024 * 1024));
    expect(parseSavingsBytes('Est savings of 10 ms')).toBe(0);
    expect(parseSavingsBytes('Total size was 8,773 KiB')).toBe(0); // a size, not a saving
    expect(parseSavingsBytes(undefined)).toBe(0);
  });
  it('per-metric milliseconds (never the unitless CLS), the details, or the text', () => {
    expect(performanceSavings({ metricSavings: { TBT: 1750 } })).toEqual({ ms: 1750, bytes: 0 });
    expect(performanceSavings({ metricSavings: { LCP: 0, FCP: 50 } })).toEqual({ ms: 50, bytes: 0 });
    expect(performanceSavings({ metricSavings: { CLS: 0.4 } })).toEqual({ ms: 0, bytes: 0 });
    expect(performanceSavings({ details: { overallSavingsMs: 300, overallSavingsBytes: 1000 } })).toEqual({ ms: 300, bytes: 1000 });
    expect(performanceSavings({ displayValue: 'Est savings of 40 ms' })).toEqual({ ms: 40, bytes: 0 });
    expect(performanceSavings({ displayValue: 'Est savings of 1.5 s' })).toEqual({ ms: 1500, bytes: 0 });
  });
});

describe('reducePageSpeedResponse — the light page (example.com, performance 100)', () => {
  const a = ok(reducePageSpeedResponse(wrap(EXAMPLE)));

  it('reads the four scores as 0–100 integers', () => {
    expect(a.scores).toEqual({ performance: 100, seo: 80, accessibility: 96, bestPractices: 100 });
  });
  it('reads the web-vitals: lab LCP and CLS; INP is field data only, so null when Google has none', () => {
    expect(a.metrics).toEqual({ lcpMs: 203, cls: 0, inpMs: null });
  });
  it('lists the failed audits of SEO and accessibility with Google\'s own words, heaviest first', () => {
    expect(a.findings.map((f) => f.id)).toEqual(['landmark-one-main', 'link-text', 'meta-description']);
    expect(a.findings[0]).toMatchObject({ title: 'Document does not have a main landmark.', categories: ['accessibility'], weight: 3 });
    expect(a.findings[1]).toMatchObject({ title: 'Links do not have descriptive text', displayValue: '1 link found', categories: ['seo'] });
    expect(a.findings[2].description).toContain('Meta descriptions may be included in search results');
  });
  it('puts NOTHING from performance on a perfect page: its insights "fail" with a score of 0 or 0.5 but have no savings worth the name', () => {
    // real: cache-insight 0.5 ("Est savings of 2 KiB"), network-dependency-tree-insight 0, render-blocking-insight 0.5 — on a page that scores 100
    for (const id of ['cache-insight', 'network-dependency-tree-insight', 'render-blocking-insight']) {
      expect(isFailedAudit(EXAMPLE.audits[id]), id).toBe(true);
      expect(a.findings.some((f) => f.id === id), id).toBe(false);
    }
    expect(a.findings.some((f) => f.categories.includes('performance'))).toBe(false);
  });
  it('never turns an audit Google failed to measure into a finding', () => {
    expect(a.findings.some((f) => f.id === 'server-response-time' || f.id === 'document-latency-insight')).toBe(false);
  });
  it('keeps the version and the address Google really analysed', () => {
    expect(a.lighthouseVersion).toBe('13.5.0');
    expect(a.finalUrl).toBe('https://example.com/');
    expect(a.analysedAt).toBe('2026-10-16T14:46:00.000Z');
  });
});

describe('reducePageSpeedResponse — the heavy page (performance 61)', () => {
  const a = ok(reducePageSpeedResponse(wrap(HEAVY)));
  const ids = a.findings.map((f) => f.id);

  it('scores and vitals', () => {
    expect(a.scores).toEqual({ performance: 61, seo: 85, accessibility: 82, bestPractices: 96 });
    expect(a.metrics).toEqual({ lcpMs: 1243, cls: 0.0011, inpMs: null });
  });

  it('keeps the five LARGEST performance findings, time before bytes: the two that cost seconds, then the three that cost megabytes', () => {
    expect(ids.slice(0, PERF_MAX_FINDINGS)).toEqual(['bootup-time', 'mainthread-work-breakdown', 'unused-javascript', 'image-delivery-insight', 'cache-insight']);
    const by = Object.fromEntries(a.findings.map((f) => [f.id, f]));
    expect(by['bootup-time'].savings).toEqual({ ms: 1750 });
    expect(by['mainthread-work-breakdown'].savings).toEqual({ ms: 1600 });
    expect(by['unused-javascript'].savings).toEqual({ bytes: 1954540 });       // from details.overallSavingsBytes
    expect(by['image-delivery-insight'].savings).toEqual({ bytes: 1687 * 1024 }); // only in the display text
    expect(by['cache-insight'].savings).toEqual({ bytes: 665 * 1024 });
  });

  it('drops the performance "failures" that are not worth a founder\'s time, each for a stated reason', () => {
    const dropped: Record<string, string> = {
      'render-blocking-insight': '50 ms', 'legacy-javascript-insight': '41 KiB', 'duplicated-javascript-insight': '1 KiB', 'font-display-insight': '10 ms',
      'forced-reflow-insight': 'no savings', 'network-dependency-tree-insight': 'no savings', 'unsized-images': 'no savings', 'total-byte-weight': 'a size, not a saving',
      interactive: 'hidden legacy metric', 'max-potential-fid': 'hidden legacy metric',
    };
    for (const [id, why] of Object.entries(dropped)) expect(ids.includes(id), `${id} (${why})`).toBe(false);
  });

  it('never shows an informative audit even when it carries savings (long-tasks says TBT 1600 but is informative)', () => {
    expect(HEAVY.audits['long-tasks'].metricSavings).toEqual({ TBT: 1600 });
    expect(ids).not.toContain('long-tasks');
  });

  it('merges an audit shared by two categories into ONE finding (image-alt is accessibility AND SEO) with the higher weight', () => {
    expect(ids.filter((i) => i === 'image-alt')).toHaveLength(1);
    expect(a.findings.find((f) => f.id === 'image-alt')).toMatchObject({ categories: ['accessibility', 'seo'], weight: 10 });
  });

  it('hides what Lighthouse itself hides (label-content-name-mismatch is in the "hidden" group) and orders the rest by Google\'s own weight', () => {
    expect(ids).not.toContain('label-content-name-mismatch');
    expect(ids.slice(5)).toEqual(['image-alt', 'aria-hidden-focus', 'link-in-text-block', 'target-size', 'heading-order', 'landmark-one-main', 'errors-in-console', 'link-text']);
    expect(a.findings).toHaveLength(13);
  });

  it('keeps Google\'s text as it comes (markdown and all), with the non-breaking spaces made ordinary', () => {
    const f = a.findings.find((x) => x.id === 'aria-hidden-focus')!;
    expect(f.title).toBe('`[aria-hidden="true"]` elements contain focusable descendents');
    expect(f.description).toContain('[Learn how `aria-hidden` affects focusable elements](https://dequeuniversity.com/rules/axe/4.13/aria-hidden-focus)');
    const cache = a.findings.find((x) => x.id === 'cache-insight')!;
    expect(cache.displayValue).toBe('Est savings of 665 KiB');
    for (const finding of a.findings) expect(JSON.stringify(finding)).not.toContain(' ');
  });

  it('stores the essentials only: far under the table\'s 60 KB ceiling, nothing but findings, never the report', () => {
    const stored = successRow('org-1', 'https://heavy.example', 'mobile', a, '2026-10-16T15:00:00.000Z');
    expect(JSON.stringify(stored.audits).length).toBeLessThan(15_000);
    expect(Object.keys(stored.audits).sort()).toEqual(['finalUrl', 'items', 'lighthouseVersion']);
    expect(JSON.stringify(stored)).not.toContain('"audits":{"first-contentful-paint"');
  });
});

describe('reducePageSpeedResponse — when Google could not do it', () => {
  it('a runtimeError inside a 200 answer is a FAILED analysis, not a score of zero', () => {
    const r = reducePageSpeedResponse(wrap({ runtimeError: { code: 'FAILED_DOCUMENT_REQUEST', message: 'Lighthouse was unable to reliably load the page you requested.' }, categories: { performance: { score: null } } }));
    expect(r).toEqual({ ok: false, error: { kind: 'unreachable', message: 'Lighthouse was unable to reliably load the page you requested.', code: 'FAILED_DOCUMENT_REQUEST' } });
  });
  it('a protocol timeout is a timeout', () => {
    const r = reducePageSpeedResponse(wrap({ runtimeError: { code: 'PROTOCOL_TIMEOUT', message: 'x' } }));
    expect(r.ok === false && r.error.kind).toBe('timeout');
  });
  it('no scores at all, no report at all, or garbage', () => {
    expect(reducePageSpeedResponse(wrap({ categories: { performance: { score: null }, seo: { score: null } }, audits: {} }))).toMatchObject({ ok: false, error: { kind: 'unreachable' } });
    expect(reducePageSpeedResponse({})).toMatchObject({ ok: false, error: { kind: 'unknown' } });
    expect(reducePageSpeedResponse(null)).toMatchObject({ ok: false, error: { kind: 'unknown' } });
    expect(reducePageSpeedResponse('nope')).toMatchObject({ ok: false });
  });
  it('one missing category does not sink the others (that score is just null)', () => {
    const lh = { ...EXAMPLE, categories: { ...EXAMPLE.categories, seo: { score: null, auditRefs: [] } } };
    expect(ok(reducePageSpeedResponse(wrap(lh))).scores).toEqual({ performance: 100, seo: null, accessibility: 96, bestPractices: 100 });
  });
});

describe('INP — field data, when Google has it', () => {
  const withField = (metrics: unknown) => ok(reducePageSpeedResponse(wrap(EXAMPLE, { loadingExperience: { metrics } }))).metrics.inpMs;
  it('reads the 75th-percentile INP of real visits', () => {
    expect(withField({ INTERACTION_TO_NEXT_PAINT: { percentile: 180.4, category: 'FAST' } })).toBe(180);
  });
  it('is null without field data, or with nonsense', () => {
    expect(withField({})).toBeNull();
    expect(withField({ INTERACTION_TO_NEXT_PAINT: { percentile: 'fast' } })).toBeNull();
    expect(withField({ INTERACTION_TO_NEXT_PAINT: { percentile: -3 } })).toBeNull();
  });
});

describe('classifyPageSpeedHttpError — what kind of "no" it is', () => {
  // the real answer Google gave on 16/10/2026 to a request WITHOUT a key
  const KEYLESS = JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'pagespeedonline.googleapis.com' for consumer 'project_number:583797351490'.", status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded', domain: 'global' }], details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED', metadata: { quota_limit_value: '0' } }] } });
  it('no key → Google\'s shared quota is zero → "quota" (so a missing key is visible, not mistaken for a broken site)', () => {
    expect(classifyPageSpeedHttpError(429, KEYLESS)).toMatchObject({ kind: 'quota', httpStatus: 429 });
  });
  it('a key that is wrong, blocked by a referrer rule or not allowed to use the API → "key"', () => {
    expect(classifyPageSpeedHttpError(400, JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }))).toMatchObject({ kind: 'key' });
    expect(classifyPageSpeedHttpError(403, JSON.stringify({ error: { code: 403, message: 'Requests from referer <empty> are blocked.', status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }))).toMatchObject({ kind: 'key' });
    expect(classifyPageSpeedHttpError(403, JSON.stringify({ error: { code: 403, message: 'PageSpeed Insights API has not been used in project 1 before or it is disabled.', status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }))).toMatchObject({ kind: 'key' });
  });
  it('Lighthouse could not load the page → "unreachable"', () => {
    expect(classifyPageSpeedHttpError(500, JSON.stringify({ error: { code: 500, message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Lighthouse was unable to reliably load the page you requested.', status: 'INTERNAL' } }))).toMatchObject({ kind: 'unreachable' });
  });
  it('a malformed request → "invalid_url"; any other 5xx or an unreadable body is Google\'s trouble → "unknown", never "check it loads publicly"', () => {
    expect(classifyPageSpeedHttpError(400, JSON.stringify({ error: { code: 400, message: "Invalid value at 'url'", status: 'INVALID_ARGUMENT' } }))).toMatchObject({ kind: 'invalid_url' });
    expect(classifyPageSpeedHttpError(503, '<html>Service Unavailable</html>')).toMatchObject({ kind: 'unknown' });
    expect(classifyPageSpeedHttpError(502, '')).toMatchObject({ kind: 'unknown', message: 'HTTP 502' });
  });
  it('the words the founder reads: the prompt\'s own sentence for an unreachable site, and no raw Google text anywhere', () => {
    expect(websiteCheckErrorCopy('unreachable')).toBe("Google couldn't analyse this URL — check it loads publicly");
    for (const k of ['quota', 'key', 'timeout', 'network', 'invalid_url', 'unknown'] as const) expect(websiteCheckErrorCopy(k).length).toBeGreaterThan(20);
    expect(websiteCheckErrorCopy('key')).not.toMatch(/api|key|google cloud/i);
  });
});

describe('stored rows', () => {
  const analysis = ok(reducePageSpeedResponse(wrap(EXAMPLE)));
  it('a good analysis: scores, vitals and the findings under `items`; a failed one: null scores and the reason under `error`', () => {
    const good = successRow('org-1', 'https://example.com', 'mobile', analysis, '2026-10-16T15:00:00.000Z');
    expect(good).toMatchObject({ org_id: 'org-1', strategy: 'mobile', score_performance: 100, score_seo: 80, lcp_ms: 203, cls: 0, inp_ms: null });
    expect(readStoredAudits(good.audits).findings).toHaveLength(3);
    const bad = failureRow('org-1', 'https://example.com', 'desktop', { kind: 'quota', message: 'x', httpStatus: 429 }, '2026-10-16T15:00:00.000Z');
    expect(bad).toMatchObject({ score_performance: null, score_seo: null, score_accessibility: null, score_best_practices: null, lcp_ms: null, audits: { error: { kind: 'quota' } } });
    expect(hasScores(bad)).toBe(false);
    expect(hasScores(good)).toBe(true);
    expect(readStoredAudits(bad.audits)).toMatchObject({ findings: [], error: { kind: 'quota', httpStatus: 429 } });
  });
  it('reading a stored blob never trusts it: garbage becomes "nothing", an unknown error kind becomes "unknown"', () => {
    expect(readStoredAudits(null)).toEqual({ findings: [], error: null, lighthouseVersion: undefined, finalUrl: undefined });
    expect(readStoredAudits({ items: 'x', error: { kind: 'martian', message: 5 } }).error).toEqual({ kind: 'unknown', message: '' });
    expect(readStoredAudits({ items: [{ id: 'a', title: 'A' }, { nope: 1 }, null] }).findings).toHaveLength(1);
  });
});

describe('checkAllowance — one analysis per org per 7 days, per address', () => {
  const NOW = new Date('2026-10-16T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const DAY = 86_400_000;
  const okRow = (url: string, at: string) => ({ url, fetched_at: at, score_performance: 90, score_seo: 90, score_accessibility: 90, score_best_practices: 90 });
  const failedRow = (url: string, at: string) => ({ url, fetched_at: at, score_performance: null, score_seo: null, score_accessibility: null, score_best_practices: null });
  const URL1 = 'https://example.com';

  it('no website, nothing to check', () => {
    expect(checkAllowance([], null, NOW)).toEqual({ allowed: false, reason: 'no_website' });
  });
  it('the first check is allowed', () => {
    expect(checkAllowance([], URL1, NOW)).toEqual({ allowed: true });
  });
  it('a good analysis blocks for 7 days and says exactly when it unblocks', () => {
    const r = checkAllowance([okRow(URL1, ago(3 * DAY))], URL1, NOW);
    expect(r).toEqual({ allowed: false, reason: 'too_soon', nextCheckAt: new Date(NOW.getTime() - 3 * DAY + RECHECK_DAYS * DAY).toISOString() });
    expect(checkAllowance([okRow(URL1, ago(7 * DAY + 1000))], URL1, NOW)).toEqual({ allowed: true });
    expect(checkAllowance([okRow(URL1, ago(6 * DAY + 23 * 3_600_000))], URL1, NOW).reason).toBe('too_soon');
  });
  it('a founder who FIXES the address gets a check straight away: the week is per address', () => {
    expect(checkAllowance([okRow('https://old-typo.com', ago(1 * DAY))], URL1, NOW)).toEqual({ allowed: true });
  });
  it('a failed attempt does not burn the week; it only waits a few minutes so a broken address cannot hammer the quota', () => {
    expect(checkAllowance([failedRow(URL1, ago(2 * 60_000))], URL1, NOW)).toMatchObject({ allowed: false, reason: 'cooldown' });
    expect(checkAllowance([failedRow(URL1, ago((FAILED_RETRY_MINUTES + 1) * 60_000))], URL1, NOW)).toEqual({ allowed: true });
  });
  it('...also after an old good one (10 days ago, then a failure 2 minutes ago)', () => {
    expect(checkAllowance([okRow(URL1, ago(10 * DAY)), failedRow(URL1, ago(2 * 60_000))], URL1, NOW)).toMatchObject({ allowed: false, reason: 'cooldown' });
  });
  it('the back office forces it', () => {
    expect(checkAllowance([okRow(URL1, ago(1 * DAY))], URL1, NOW, { force: true })).toEqual({ allowed: true });
  });
});

describe('latestByStrategy / primaryRow', () => {
  const row = (strategy: 'mobile' | 'desktop', at: string, perf: number | null): StoredRowLike => ({
    strategy, url: 'https://example.com', fetched_at: at, score_performance: perf, score_seo: perf, score_accessibility: perf, score_best_practices: perf,
  });
  it('takes the newest row of each strategy', () => {
    const l = latestByStrategy([row('mobile', '2026-10-01T00:00:00Z', 50), row('mobile', '2026-10-09T00:00:00Z', 70), row('desktop', '2026-10-02T00:00:00Z', 80)]);
    expect(l.mobile?.fetched_at).toBe('2026-10-09T00:00:00Z');
    expect(l.desktop?.score_performance).toBe(80);
  });
  it('the summary describes mobile; if mobile failed, desktop; if both failed, nothing', () => {
    expect(primaryRow({ mobile: row('mobile', '2026-10-09T00:00:00Z', 70), desktop: row('desktop', '2026-10-09T00:00:00Z', 80) })?.strategy).toBe('mobile');
    expect(primaryRow({ mobile: row('mobile', '2026-10-09T00:00:00Z', null), desktop: row('desktop', '2026-10-09T00:00:00Z', 80) })?.strategy).toBe('desktop');
    expect(primaryRow({ mobile: row('mobile', '2026-10-09T00:00:00Z', null), desktop: null })).toBeNull();
  });
});

describe('projectWebsiteHealthForInvestor — four numbers, a date, a link; only when the founder said so', () => {
  const row = { url: 'https://example.com', fetched_at: '2026-10-12T09:30:00.000Z', score_performance: 61, score_seo: 85, score_accessibility: 82, score_best_practices: 96 };
  it('OFF (the default) → nothing, even with a perfect analysis on file', () => {
    expect(projectWebsiteHealthForInvestor(false, row)).toBeNull();
    expect(projectWebsiteHealthForInvestor(undefined as never, row)).toBeNull();
    expect(projectWebsiteHealthForInvestor('true' as never, row)).toBeNull(); // only the boolean true counts
  });
  it('ON → exactly the four scores, the strategy, the date and Google\'s report link', () => {
    expect(projectWebsiteHealthForInvestor(true, row)).toEqual({
      scores: { performance: 61, seo: 85, accessibility: 82, bestPractices: 96 }, strategy: 'mobile', checkedAt: '2026-10-12T09:30:00.000Z',
      reportUrl: 'https://pagespeed.web.dev/report?url=https%3A%2F%2Fexample.com&form_factor=mobile',
    });
  });
  it('ON but no analysis, or an analysis that is not complete → nothing (no "not shared", no half-card)', () => {
    expect(projectWebsiteHealthForInvestor(true, null)).toBeNull();
    expect(projectWebsiteHealthForInvestor(true, { ...row, score_seo: null })).toBeNull();
    expect(projectWebsiteHealthForInvestor(true, { ...row, score_performance: 101 })).toBeNull();
    expect(projectWebsiteHealthForInvestor(true, { ...row, score_best_practices: 96.5 })).toBeNull();
    expect(projectWebsiteHealthForInvestor(true, { ...row, url: 'javascript:alert(1)' })).toBeNull();
    expect(projectWebsiteHealthForInvestor(true, { ...row, fetched_at: 'yesterday' })).toBeNull();
  });
  it('the summary and the findings can NOT come out, even when the row object carries them', () => {
    const out = projectWebsiteHealthForInvestor(true, { ...row, summary: 'Fix first: …', audits: { items: [{ id: 'image-alt' }] }, summary_model: 'm', id: 'x' } as never)!;
    expect(Object.keys(out).sort()).toEqual(['checkedAt', 'reportUrl', 'scores', 'strategy']);
    expect(JSON.stringify(out)).not.toMatch(/summary|audits|image-alt|Fix first/);
  });
});

describe('formatCheckedDate', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  it('"12 Oct" this year, with the year when it is not', () => {
    expect(formatCheckedDate('2026-10-12T09:30:00Z', now)).toBe('12 Oct');
    expect(formatCheckedDate('2025-10-12T09:30:00Z', now)).toBe('12 Oct 2025');
    expect(formatCheckedDate('2026-01-05T23:59:59Z', now)).toBe('5 Jan');
    expect(formatCheckedDate('garbage', now)).toBe('');
    expect(formatCheckedDate(null, now)).toBe('');
  });
});

describe('parseLighthouseText — Google\'s little markdown, as real text and real links', () => {
  it('splits `code` and [label](https://…), and drops backticks inside a link label', () => {
    const real = HEAVY.audits['aria-hidden-focus'].description as string;
    const segs = parseLighthouseText(real);
    expect(segs.filter((s) => s.type === 'code').map((s) => (s as { value: string }).value)).toEqual(['[aria-hidden="true"]']);
    expect(segs.find((s) => s.type === 'link')).toEqual({ type: 'link', label: 'Learn how aria-hidden affects focusable elements', href: 'https://dequeuniversity.com/rules/axe/4.13/aria-hidden-focus' });
    // nothing is lost: text + code + link labels reassemble to the sentence (minus markdown punctuation)
    expect(segs.map((s) => (s.type === 'link' ? s.label : s.value)).join('')).toContain('prevent those interactive elements from being available');
  });
  it('only http(s) links become links; anything else stays as plain text', () => {
    expect(parseLighthouseText('see [x](javascript:alert(1)) now')).toEqual([{ type: 'text', value: 'see [x](javascript:alert(1)) now' }]);
    expect(parseLighthouseText('[a](http://a.example/x) and [b](https://b.example/y)').filter((s) => s.type === 'link')).toHaveLength(2);
  });
  it('an unterminated backtick is text, not a crash', () => {
    expect(parseLighthouseText('a ` b')).toEqual([{ type: 'text', value: 'a ' }, { type: 'text', value: '` b' }]);
    expect(parseLighthouseText('')).toEqual([]);
  });
});
