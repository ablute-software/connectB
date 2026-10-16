// Prompt 919 — the ORDER of a website check and of a summary, proved with injected side effects (the same way company-badge-verify-core is
// proved): a check is FREE and always stores something true; a summary charges the wallet BEFORE the model and, when the wallet says no,
// nothing else happens — not the model, not a write — and the analysis already on file is untouched.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { reducePageSpeedResponse, type ReduceResult, type StoredRowLike } from './website-health';
import { runWebsiteCheck, runWebsiteSummary, type AuditInsert, type CheckDeps, type SummaryDeps } from './website-health-run';
import { SUMMARY_TOOL_NAME } from './website-health-summary';

const fixture = (n: string) => JSON.parse(readFileSync(path.resolve(__dirname, `__fixtures__/${n}`), 'utf8')) as unknown;
const EXAMPLE_OK = reducePageSpeedResponse({ lighthouseResult: fixture('pagespeed-example-mobile.json') });
const HEAVY_OK = reducePageSpeedResponse({ lighthouseResult: fixture('pagespeed-heavy-mobile.json') });
if (!EXAMPLE_OK.ok || !HEAVY_OK.ok) throw new Error('fixtures must reduce');
const NOW = new Date('2026-10-16T12:00:00.000Z');
const FAIL: ReduceResult = { ok: false, error: { kind: 'unreachable', message: 'Lighthouse was unable to reliably load the page you requested.', code: 'FAILED_DOCUMENT_REQUEST' } };

function checkDeps(over: Partial<CheckDeps> & { rows?: StoredRowLike[] } = {}) {
  const log: string[] = [];
  const inserted: AuditInsert[][] = [];
  const deps: CheckDeps = {
    now: () => NOW,
    loadRows: async () => { log.push('load'); return over.rows ?? []; },
    analyse: over.analyse ?? (async (_url, strategy) => { log.push(`analyse:${strategy}`); return strategy === 'mobile' ? HEAVY_OK : EXAMPLE_OK; }),
    insertRows: over.insertRows ?? (async (rows) => { log.push('insert'); inserted.push(rows); return { error: null }; }),
  };
  return { deps, log, inserted };
}
const goodRow = (url: string, at: string): StoredRowLike => ({ strategy: 'mobile', url, fetched_at: at, score_performance: 90, score_seo: 90, score_accessibility: 90, score_best_practices: 90 });

describe('runWebsiteCheck', () => {
  it('no website on file, or one that is not a public address: nothing is asked of Google and nothing is stored', async () => {
    for (const [website, reason] of [[null, 'no_website'], ['', 'no_website'], ['   ', 'no_website'], ['http://localhost:3000', 'invalid_website'], ['not a url', 'invalid_website']] as const) {
      const { deps, log } = checkDeps();
      expect(await runWebsiteCheck({ orgId: 'o', website }, deps), String(website)).toEqual({ kind: 'blocked', reason });
      expect(log, String(website)).toEqual([]);
    }
  });

  it('a good analysis in the last 7 days blocks the check BEFORE Google is asked, and says when it unblocks', async () => {
    const { deps, log, inserted } = checkDeps({ rows: [goodRow('https://example.com', '2026-10-14T12:00:00.000Z')] });
    const r = await runWebsiteCheck({ orgId: 'o', website: 'example.com' }, deps);
    expect(r).toEqual({ kind: 'blocked', reason: 'too_soon', nextCheckAt: '2026-10-21T12:00:00.000Z' });
    expect(log).toEqual(['load']);
    expect(inserted).toEqual([]);
  });

  it('the back office can force it past the 7 days', async () => {
    const { deps, inserted } = checkDeps({ rows: [goodRow('https://example.com', '2026-10-14T12:00:00.000Z')] });
    const r = await runWebsiteCheck({ orgId: 'o', website: 'example.com', force: true }, deps);
    expect(r.kind).toBe('done');
    expect(inserted).toHaveLength(1);
  });

  it('asks Google for mobile AND desktop AT THE SAME TIME (one function has 60 s; a call takes 10–40), then stores both rows in ONE insert with one timestamp', async () => {
    const started: string[] = [];
    const release: Record<string, () => void> = {};
    const analyse = (_u: string, s: 'mobile' | 'desktop') => new Promise<ReduceResult>((resolve) => { started.push(s); release[s] = () => resolve(s === 'mobile' ? HEAVY_OK : EXAMPLE_OK); });
    const { deps, inserted } = checkDeps({ analyse });
    const run = runWebsiteCheck({ orgId: 'org-1', website: 'https://www.example.com/' }, deps);
    await vi.waitFor(() => expect(started.sort()).toEqual(['desktop', 'mobile'])); // both are in flight before either has answered
    expect(inserted).toEqual([]);
    release.mobile(); release.desktop();
    const r = await run;
    expect(r).toMatchObject({ kind: 'done', url: 'https://www.example.com', fetchedAt: NOW.toISOString(), anyOk: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].map((x) => x.strategy)).toEqual(['mobile', 'desktop']);
    expect(new Set(inserted[0].map((x) => x.fetched_at)).size).toBe(1);
    expect(inserted[0].every((x) => x.org_id === 'org-1' && x.url === 'https://www.example.com')).toBe(true);
    expect(inserted[0][0]).toMatchObject({ score_performance: 61, score_seo: 85, score_accessibility: 82, score_best_practices: 96 }); // the heavy page
    expect(inserted[0][1]).toMatchObject({ score_performance: 100, score_seo: 80 });                                                      // example.com
  });

  it('when Google cannot do one of them, THAT row says why (null scores) and the other still lands; nothing is lost', async () => {
    const { deps, inserted } = checkDeps({ analyse: async (_u, s) => (s === 'mobile' ? HEAVY_OK : FAIL) });
    const r = await runWebsiteCheck({ orgId: 'o', website: 'example.com' }, deps);
    expect(r).toMatchObject({ kind: 'done', anyOk: true });
    if (r.kind !== 'done') throw new Error('x');
    expect(r.results).toEqual([{ strategy: 'mobile', ok: true }, { strategy: 'desktop', ok: false, error: { kind: 'unreachable', message: 'Lighthouse was unable to reliably load the page you requested.', code: 'FAILED_DOCUMENT_REQUEST' } }]);
    expect(inserted[0][1]).toMatchObject({ strategy: 'desktop', score_performance: null, audits: { error: { kind: 'unreachable' } } });
  });

  it('when Google cannot do either, both failures are STORED (the card then has a true thing to say) and the answer is anyOk:false', async () => {
    const { deps, inserted } = checkDeps({ analyse: async () => ({ ok: false, error: { kind: 'quota', message: 'Quota exceeded', httpStatus: 429 } }) });
    const r = await runWebsiteCheck({ orgId: 'o', website: 'example.com' }, deps);
    expect(r).toMatchObject({ kind: 'done', anyOk: false });
    expect(inserted[0].map((x) => (x.audits as { error: { kind: string } }).error.kind)).toEqual(['quota', 'quota']);
  });

  it('a storage failure is reported, not swallowed', async () => {
    const { deps } = checkDeps({ insertRows: async () => ({ error: 'relation "org_website_audits" does not exist' }) });
    expect(await runWebsiteCheck({ orgId: 'o', website: 'example.com' }, deps)).toEqual({ kind: 'storage_failed', error: 'relation "org_website_audits" does not exist' });
  });

  it('a check has no way to touch the wallet: its dependencies do not include one', () => {
    const { deps } = checkDeps();
    expect(Object.keys(deps).sort()).toEqual(['analyse', 'insertRows', 'loadRows', 'now']);
  });
});

const SUMMARY_INPUT = {
  website: 'https://heavy.example', strategy: 'mobile' as const, scores: HEAVY_OK.analysis.scores, metrics: HEAVY_OK.analysis.metrics, findings: HEAVY_OK.analysis.findings,
};
const GOOD_TOOL_USE = {
  type: 'tool_use', name: SUMMARY_TOOL_NAME,
  input: {
    headline: 'Your site is usable but slow to respond on a phone.',
    fix_first: [{ audit_ids: ['bootup-time'], what: 'Too much JavaScript runs on load.', why_it_matters: 'Visitors wait before they can tap.', how: 'Ask your developer to delay non-essential scripts.' }],
    doing_well: [{ category: 'best-practices', text: 'The site follows the safe habits browsers expect.' }],
  },
};

function summaryDeps(over: Partial<SummaryDeps> = {}) {
  const log: string[] = [];
  const deps: SummaryDeps = {
    charge: over.charge ?? (async () => { log.push('charge'); return { ok: true, reason: null }; }),
    callModel: over.callModel ?? (async (body) => { log.push('model'); log.push(`model-tool:${(body.tool_choice as { name: string }).name}`); return { content: [GOOD_TOOL_USE], usage: { input_tokens: 1800, output_tokens: 220 } }; }),
    logUsage: over.logUsage ?? (async () => { log.push('log'); }),
    chargedCredits: over.chargedCredits ?? (async () => { log.push('credits'); return 2; }),
  };
  return { deps, log };
}

describe('runWebsiteSummary — the wallet first, then the model, then only what Google reported', () => {
  it('charges BEFORE the model is called, logs the usage, reads what was charged, and returns the validated summary', async () => {
    const { deps, log } = summaryDeps();
    const r = await runWebsiteSummary(SUMMARY_INPUT, deps);
    expect(log).toEqual(['charge', 'model', 'model-tool:report_website_summary', 'log', 'credits']);
    expect(r).toMatchObject({ kind: 'done', model: 'claude-haiku-4-5', credits: 2 });
    if (r.kind !== 'done') throw new Error('x');
    expect(r.summary.fixFirst[0].auditIds).toEqual(['bootup-time']);
    expect(r.summary.doingWell).toEqual([{ category: 'best-practices', text: 'The site follows the safe habits browsers expect.' }]);
    expect(r.telemetry.estimatedInputTokens).toBeLessThanOrEqual(6000);
  });

  it('with the wallet at zero: refused, the wallet\'s own words, and NOTHING else ran — no model, no usage log', async () => {
    const { deps, log } = summaryDeps({ charge: async () => { log2.push('charge'); return { ok: false, reason: 'AI credits limit reached (80 of 80 this month).' }; } });
    const log2: string[] = [];
    const r = await runWebsiteSummary(SUMMARY_INPUT, deps);
    expect(r).toEqual({ kind: 'refused', error: 'AI credits limit reached (80 of 80 this month).' });
    expect(log2).toEqual(['charge']);
    expect(log).toEqual([]); // not 'model', not 'log', not 'credits'
  });

  it('a refusal without a reason still says something readable', async () => {
    const { deps } = summaryDeps({ charge: async () => ({ ok: false, reason: null }) });
    expect(await runWebsiteSummary(SUMMARY_INPUT, deps)).toEqual({ kind: 'refused', error: 'Not enough AI credits for this summary.' });
  });

  it('if the model answers with nothing usable the credits ARE spent (no refund mechanism exists) and the outcome says so', async () => {
    const { deps } = summaryDeps({ callModel: async () => ({ content: [{ type: 'text', text: 'I could not do that.' }], usage: {} }) });
    expect(await runWebsiteSummary(SUMMARY_INPUT, deps)).toEqual({ kind: 'unusable', credits: 2 });
  });

  it('an answer that cites only audits Google never reported leaves a headline and no invented fixes', async () => {
    const invented = { ...GOOD_TOOL_USE, input: { ...GOOD_TOOL_USE.input, fix_first: [{ audit_ids: ['nonexistent'], what: 'x', why_it_matters: 'y', how: 'z' }] } };
    const { deps } = summaryDeps({ callModel: async () => ({ content: [invented], usage: {} }) });
    const r = await runWebsiteSummary(SUMMARY_INPUT, deps);
    expect(r).toMatchObject({ kind: 'done' });
    if (r.kind === 'done') expect(r.summary.fixFirst).toEqual([]);
  });

  it('a provider error after the charge propagates (the route answers 502); the order is still charge, then model', async () => {
    const { deps, log } = summaryDeps({ callModel: async () => { log.push('model-attempt'); throw new Error('overloaded'); } });
    await expect(runWebsiteSummary(SUMMARY_INPUT, deps)).rejects.toThrow('overloaded');
    expect(log).toEqual(['charge', 'model-attempt']);
  });
});
