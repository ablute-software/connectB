// Prompt 919 C / D / E — what the three surfaces SAY, rendered with react-dom/server (no DOM library in this repo) over states built by the
// real reducer from the real Lighthouse fixtures: the founder's card, the investor's small block, and the back office's card.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BAND_COLOR, failureRow, pageSpeedReportUrl, reducePageSpeedResponse, successRow, type StoredRowLike, type WebsiteHealthPublic, type WebsiteStrategy } from '@/lib/website-health';
import { buildFounderState, type WebsiteHealthState } from '@/lib/website-health-state';
import { serializeSummary, type WebsiteSummary } from '@/lib/website-health-summary';
import { SHARE_HELP, SHARE_LABEL, ScoreArc, WEBSITE_HEALTH_INTRO, WebsiteHealthCardView, type WebsiteHealthCardViewProps } from './WebsiteHealthCard';
import { InvestorWebsiteHealth, WEBSITE_HEALTH_TOOLTIP } from '@/components/portal/InvestorWebsiteHealth';
import { WebsiteHealthBackofficeView, type BackofficePayload } from '@/components/backoffice/WebsiteHealthBackofficeCard';

const fixture = (n: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../lib/__fixtures__/${n}`), 'utf8')) as unknown;
const reduced = (n: string) => { const r = reducePageSpeedResponse({ lighthouseResult: fixture(n) }); if (!r.ok) throw new Error('fixture must reduce'); return r.analysis; };
const HEAVY = reduced('pagespeed-heavy-mobile.json');
const EXAMPLE = reduced('pagespeed-example-mobile.json');
const NOW = new Date('2026-10-16T12:00:00.000Z');
const AT = '2026-10-14T09:30:00.000Z';
const SITE = 'https://example.com';
const noop = () => {};

const ok = (strategy: WebsiteStrategy, a = HEAVY, extra: Partial<StoredRowLike> = {}): StoredRowLike => ({ ...successRow('o', SITE, strategy, a, AT), ...extra }) as StoredRowLike;
const bad = (strategy: WebsiteStrategy): StoredRowLike => failureRow('o', SITE, strategy, { kind: 'unreachable', message: 'RAW GOOGLE TEXT — back office only', httpStatus: 500 }, AT) as StoredRowLike;
const SUMMARY: WebsiteSummary = {
  v: 1, headline: 'Your site is usable but slow to respond on a phone.',
  fixFirst: [{ auditIds: ['bootup-time'], what: 'Too much JavaScript runs on load.', whyItMatters: 'Visitors wait before they can tap.', how: 'Ask your developer to delay non-essential scripts.' }],
  doingWell: [{ category: 'best-practices', text: 'The site follows the safe habits browsers expect.' }],
};

const state = (over: { website?: string | null; visible?: boolean; rows?: StoredRowLike[]; now?: Date } = {}): WebsiteHealthState =>
  buildFounderState({ website: over.website === undefined ? SITE : over.website, visible: over.visible ?? false, rows: over.rows ?? [], now: over.now ?? NOW });
const card = (s: WebsiteHealthState, over: Partial<WebsiteHealthCardViewProps> = {}) =>
  renderToStaticMarkup(createElement(WebsiteHealthCardView, { state: s, strategy: 'mobile', onStrategy: noop, busy: null, onCheck: noop, onSummary: noop, onShare: noop, now: NOW, ...over }));
/** The words a reader sees, markup stripped. */
const text = (html: string) => html
  .replace(/<\/?(?:p|div|h\d|li|ul|ol|dl|dt|dd|summary|details|label|button|input|svg|circle|text|section)\b[^>]*>/g, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
/** React renders a disabled control as ` disabled=""`; the class list also says `disabled:` (Tailwind), which is not the attribute. */
const isDisabled = (button: string) => / disabled=""/.test(button);
const buttonOf = (html: string, label: RegExp) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label.source}(?:(?!</button>).)*</button>`, 's'))?.[0] ?? '';
const BOTH = [ok('mobile'), ok('desktop', EXAMPLE)];

describe('the founder\'s card — without a usable website', () => {
  it('no website on file: says where to add it, and NOTHING else — no button, no switch, no arcs, no intro', () => {
    const html = card(state({ website: null }));
    expect(text(html)).toBe('Website health Add your website in About › Company to run this check');
    expect(html).toContain('href="/settings?tab=about#identity.website"');
    for (const absent of ['Run the check', 'Re-check', 'role="switch"', 'data-score-band', 'role="img"', WEBSITE_HEALTH_INTRO.slice(0, 20)]) expect(html).not.toContain(absent);
  });

  it('a website that is not a public address: says to fix it there, nothing to run', () => {
    const html = card(state({ website: 'http://localhost:3000' }));
    expect(text(html)).toBe('Website health The website in About › Company is not a public web address — fix it there to run this check');
    expect(html).not.toContain('Run the check');
    expect(html).not.toContain('role="switch"');
  });
});

describe('the founder\'s card — a website, nothing checked yet', () => {
  const html = card(state());
  it('names the site, offers a FREE check, and has no scores to show', () => {
    expect(text(html)).toContain('Ready to check example.com. It is free, takes up to a minute, and runs on Google\'s side.');
    expect(text(html)).toContain(WEBSITE_HEALTH_INTRO);
    expect(html).not.toContain('data-score-band');
    expect(html).not.toContain('All findings');
    expect(html).not.toContain('Get the summary');
  });
  it('the button is "Run the check", enabled; while Google works it says so and is disabled', () => {
    const idle = buttonOf(html, /Run the check/);
    expect(idle).toContain('Run the check');
    expect(isDisabled(idle)).toBe(false);
    const working = buttonOf(card(state(), { busy: 'check' }), /Checking/);
    expect(working).toContain('Checking… up to a minute');
    expect(isDisabled(working)).toBe(true);
  });
  it('the sharing switch is there, OFF, with the exact label and help text from the brief', () => {
    expect(SHARE_LABEL).toBe('Show my website health score to investors');
    expect(SHARE_HELP).toBe('Investors see only the four Google scores and the date — no summary, no findings. Off by default; this is not part of how Sherlock presents your company.');
    expect(text(html)).toContain(SHARE_LABEL);
    expect(text(html)).toContain(SHARE_HELP);
    expect(html).toMatch(/<input[^>]*role="switch"/);
    expect(html).not.toMatch(/<input[^>]*checked=""/);
  });
});

describe('the founder\'s card — with an analysis', () => {
  const s = state({ rows: BOTH });

  it('the phone check is the default: four arcs with the phone page\'s scores, on Google\'s colour scale (61 · 85 · 82 orange, 96 green)', () => {
    const html = card(s);
    expect(html).toContain('aria-label="Performance: 61 out of 100"');
    expect(html).toContain('aria-label="SEO: 85 out of 100"');
    expect(html).toContain('aria-label="Accessibility: 82 out of 100"');
    expect(html).toContain('aria-label="Best practices: 96 out of 100"');
    expect(html.match(/data-score-band="orange"/g)).toHaveLength(3);
    expect(html.match(/data-score-band="green"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*>Mobile</);
    expect(html).toMatch(/aria-selected="false"[^>]*>Desktop</);
  });

  it('Desktop is a toggle: the same card with the desktop scores (100 · 80 · 96 · 100)', () => {
    const html = card(s, { strategy: 'desktop' });
    expect(html).toContain('aria-label="Performance: 100 out of 100"');
    expect(html).toContain('aria-label="SEO: 80 out of 100"');
    expect(html).toContain('aria-label="Accessibility: 96 out of 100"');
    expect(html).toContain('aria-label="Best practices: 100 out of 100"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Desktop</);
  });

  it('the scale is Google\'s: 0–49 red, 50–89 orange, 90–100 green, at the edges', () => {
    const band = (n: number | null) => renderToStaticMarkup(createElement(ScoreArc, { label: 'X', score: n })).match(/data-score-band="(\w+)"/)![1];
    expect([0, 1, 49].map(band)).toEqual(['red', 'red', 'red']);
    expect([50, 51, 89].map(band)).toEqual(['orange', 'orange', 'orange']);
    expect([90, 91, 100].map(band)).toEqual(['green', 'green', 'green']);
    expect(band(null)).toBe('none');
    const html = renderToStaticMarkup(createElement(ScoreArc, { label: 'X', score: 49 }));
    expect(html).toContain(BAND_COLOR.red.arc);
    expect(renderToStaticMarkup(createElement(ScoreArc, { label: 'X', score: 90 }))).toContain(BAND_COLOR.green.arc);
  });

  it('shows the date, the next date, and a Re-check that is DISABLED with the next date while the 7 days run', () => {
    const html = card(s);
    expect(text(html)).toContain('example.com · checked 14 Oct · next check available 21 Oct');
    const recheck = buttonOf(html, /Re-check/);
    expect(isDisabled(recheck)).toBe(true);
    expect(recheck).toContain('title="Next check available 21 Oct"');
  });

  it('after the 7 days the Re-check is enabled and no "next check" is announced', () => {
    const later = state({ rows: BOTH, now: new Date('2026-10-22T12:00:00.000Z') });
    const html = card(later, { now: new Date('2026-10-22T12:00:00.000Z') });
    expect(isDisabled(buttonOf(html, /Re-check/))).toBe(false);
    expect(text(html)).not.toContain('next check available');
  });

  it('the load-time numbers a founder can picture', () => {
    expect(text(card(s))).toContain('Main content appears after 1.2 s · Layout shift 0.0011');
  });

  it('"All findings (13)" holds Google\'s own text for every finding, with its category, and a link to Google\'s report', () => {
    const html = card(s);
    expect(html).toContain('<details');
    expect(text(html)).toContain('All findings (13)');
    const findings = s.analyses.mobile!.findings;
    expect(findings).toHaveLength(13);
    for (const f of findings) expect(html, f.id).toContain(`data-finding="${f.id}"`);
    const boot = findings.find((f) => f.id === 'bootup-time')!;
    expect(boot.title).not.toMatch(/[`[]/); // a plain title, so it can be compared as is
    expect(text(html)).toContain(boot.title);
    expect(html).toContain('href="https://pagespeed.web.dev/report?url=https%3A%2F%2Fexample.com&amp;form_factor=mobile"');
    expect(html).toContain('rel="noopener nofollow"');
  });

  it('Google\'s little markdown becomes real links and code, not stray punctuation', () => {
    const html = card(s);
    expect(html).toMatch(/<a href="https:\/\/[^"]+" target="_blank" rel="noopener nofollow"[^>]*>[^<]+<\/a>/);
    expect(html).not.toMatch(/\]\(https?:\/\//); // no raw "[label](url)" left over
  });

  it('a perfect-ish page lists what little there is and says so when there is nothing', () => {
    const clean = state({ rows: [ok('mobile', { ...EXAMPLE, findings: [] })] });
    expect(text(card(clean))).toContain('All findings (0)');
    expect(text(card(clean))).toContain('Google found nothing worth listing on this check.');
  });
});

describe('the founder\'s card — the summary', () => {
  it('not asked for yet: the offer, with the price from the wallet (2 by default), and the button works only when idle', () => {
    const s = state({ rows: BOTH });
    expect(s.summaryOffered).toBe(true);
    expect(text(card(s))).toContain('Want it in plain words?');
    expect(text(card(s))).toContain('Get the summary (2 credits)');
    expect(text(card(s, { summaryCost: 3 }))).toContain('Get the summary (3 credits)');
    expect(text(card(s, { summaryCost: 1 }))).toContain('Get the summary (1 credit)');
    expect(isDisabled(buttonOf(card(s), /Get the summary/))).toBe(false);
    const busy = buttonOf(card(s, { busy: 'summary' }), /Reading the results/);
    expect(busy).toContain('Reading the results…');
    expect(isDisabled(busy)).toBe(true);
  });

  it('after a refusal from the wallet the analysis is still there and the same button is still offered', () => {
    const html = card(state({ rows: BOTH }), { error: 'AI credits limit reached (80 of 80 this month).' });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('AI credits limit reached (80 of 80 this month).');
    expect(html).toContain('aria-label="Performance: 61 out of 100"');
    expect(text(html)).toContain('Get the summary (2 credits)');
  });

  it('with a summary: the headline, Fix first (what, why it matters, how to start, and Google\'s own finding it comes from), Doing well — and no offer', () => {
    const s = state({ rows: [ok('mobile', HEAVY, { summary: serializeSummary(SUMMARY) }), ok('desktop', EXAMPLE)] });
    const html = card(s);
    const t = text(html);
    expect(html).toContain('data-testid="website-summary"');
    expect(t).toContain(SUMMARY.headline);
    expect(t).toContain('Summary of the phone check');
    expect(t).toContain('Fix first');
    expect(t).toContain('1. Too much JavaScript runs on load.');
    expect(t).toContain('Why it matters: Visitors wait before they can tap.');
    expect(t).toContain('How to start: Ask your developer to delay non-essential scripts.');
    expect(t).toContain(`Google's finding: ${s.analyses.mobile!.findings.find((f) => f.id === 'bootup-time')!.title}`);
    expect(t).toContain('Doing well');
    expect(t).toContain('Best practices. The site follows the safe habits browsers expect.');
    expect(t).not.toContain('Get the summary');
    expect(t).not.toContain('Want it in plain words?');
  });

  it('no scores at all (both checks failed): nothing to summarise, so nothing is offered', () => {
    expect(text(card(state({ rows: [bad('mobile'), bad('desktop')] })))).not.toContain('Get the summary');
  });
});

describe('the founder\'s card — when Google could not do it', () => {
  it('says the founder-safe sentence, draws no arcs and no findings, and never shows Google\'s raw text', () => {
    const html = card(state({ rows: [bad('mobile'), bad('desktop')] }));
    expect(html).toContain('data-testid="website-check-error"');
    expect(text(html)).toContain("Google couldn't analyse this URL — check it loads publicly");
    expect(html).not.toContain('data-score-band');
    expect(html).not.toContain('All findings');
    expect(html).not.toContain('RAW GOOGLE TEXT');
  });
  it('a failed phone check does not hide a working desktop one', () => {
    const s = state({ rows: [bad('mobile'), ok('desktop', EXAMPLE)] });
    expect(card(s, { strategy: 'mobile' })).toContain('data-testid="website-check-error"');
    expect(card(s, { strategy: 'desktop' })).toContain('aria-label="Performance: 100 out of 100"');
  });
});

describe('the founder\'s card — the sharing switch', () => {
  it('OFF by default; ON when the founder turned it on; cannot be flipped while something is saving', () => {
    expect(card(state({ rows: BOTH }))).not.toMatch(/<input[^>]*checked=""/);
    expect(card(state({ rows: BOTH, visible: true }))).toMatch(/<input[^>]*role="switch"[^>]*checked=""|<input[^>]*checked=""[^>]*role="switch"/);
    expect(card(state({ rows: BOTH }), { busy: 'share' })).toMatch(/<input[^>]*disabled=""/);
  });
});

// ─── the investor's block ────────────────────────────────────────────────────────────────────────────────────
const PUBLIC: WebsiteHealthPublic = { scores: { performance: 61, seo: 85, accessibility: 82, bestPractices: 96 }, strategy: 'mobile', checkedAt: '2026-10-12T09:30:00.000Z', reportUrl: pageSpeedReportUrl(SITE, 'mobile') };
const investor = (wh: WebsiteHealthPublic | null | undefined) => renderToStaticMarkup(createElement(InvestorWebsiteHealth, { websiteHealth: wh }));

describe('the investor\'s block', () => {
  it('nothing given (switch off, or no analysis): nothing is drawn — not a heading, not a "not shared" line', () => {
    expect(investor(null)).toBe('');
    expect(investor(undefined)).toBe('');
  });

  it('given one: "Website health · Google PageSpeed (mobile) · checked 12 Oct", the four numbers, Google\'s own report — and the founder\'s tooltip', () => {
    const html = investor(PUBLIC);
    expect(text(html)).toContain('Website health · Google PageSpeed (mobile) · checked 12 Oct');
    for (const [label, n] of [['Performance', 61], ['SEO', 85], ['Accessibility', 82], ['Best practices', 96]] as const) expect(text(html)).toContain(`${n} ${label}`);
    expect(html).toContain(`title="${WEBSITE_HEALTH_TOOLTIP.replace(/'/g, '&#x27;')}"`);
    expect(WEBSITE_HEALTH_TOOLTIP).toBe("Public measurement by Google of the company's website. Shared by the founder.");
    expect(html).toContain('href="https://pagespeed.web.dev/report?url=https%3A%2F%2Fexample.com&amp;form_factor=mobile"');
    expect(html).toContain('rel="noopener nofollow"');
  });

  it('passes NO judgement: no colour scale, no adjective, no comparison, nothing about the team', () => {
    const html = investor({ ...PUBLIC, scores: { performance: 12, seo: 99, accessibility: 50, bestPractices: 100 } });
    for (const c of Object.values(BAND_COLOR)) { expect(html).not.toContain(c.arc); expect(html).not.toContain(c.text); }
    expect(html).not.toContain('data-score-band');
    expect(/\b(good|great|poor|bad|weak|strong|excellent|failing|average|below|above|better|worse|ranking|percentile|benchmark|healthy|unhealthy)\b/i.test(text(html)), text(html)).toBe(false);
    expect(/\b(team|founder|management|execution|attention|care)\b/i.test(text(html).split(WEBSITE_HEALTH_TOOLTIP).join(''))).toBe(false);
  });

  it('carries no summary and no findings — the component has nowhere to put them', () => {
    const smuggled = { ...PUBLIC, summary: 'SUMMARY-SENTINEL', findings: ['FINDING-SENTINEL'] } as unknown as WebsiteHealthPublic;
    const html = investor(smuggled);
    expect(html).not.toContain('SUMMARY-SENTINEL');
    expect(html).not.toContain('FINDING-SENTINEL');
  });
});

// ─── the back office's card ──────────────────────────────────────────────────────────────────────────────────
const bo = (data: BackofficePayload | null, over: { busy?: boolean; msg?: string } = {}) =>
  renderToStaticMarkup(createElement(WebsiteHealthBackofficeView, { data, busy: over.busy ?? false, msg: over.msg ?? '', onForce: noop }));
const boOk: BackofficePayload = {
  ok: true, available: true, orgName: 'zz-test-site-A', rawWebsite: 'https://www.example.com/', website: 'https://www.example.com', keyConfigured: true, visibleToInvestors: true,
  latest: {
    mobile: { fetchedAt: '2026-10-14T09:30:00.000Z', url: 'https://www.example.com', ok: true, findings: 13, scores: { performance: 61, seo: 85, accessibility: 82, bestPractices: 96 }, error: null },
    desktop: { fetchedAt: '2026-10-14T09:30:00.000Z', url: 'https://www.example.com', ok: false, findings: 0, scores: { performance: null, seo: null, accessibility: null, bestPractices: null }, error: { kind: 'quota', message: "Quota exceeded for quota metric 'Queries'", httpStatus: 429 } },
  },
  allowance: { allowed: false, reason: 'too_soon', nextCheckAt: '2026-10-21T09:30:00.000Z' },
};

describe('the back office\'s card', () => {
  it('not loaded, or the migration is not applied: nothing is drawn', () => {
    expect(bo(null)).toBe('');
    expect(bo({ ok: true, available: false })).toBe('');
  });

  it('shows the last analysis of each strategy with its date, the RAW reason of a failure, whether it is shared, and whether the key is set', () => {
    const t = text(bo(boOk));
    expect(t).toContain('Website on file: https://www.example.com/');
    expect(t).toContain('Mobile: performance 61 · SEO 85 · accessibility 82 · best practices 96 — 14 Oct, 13 findings');
    expect(t).toContain('Desktop: failed on 14 Oct — quota (HTTP 429)');
    expect(t).toContain("Quota exceeded for quota metric 'Queries'");
    expect(t).toContain('Shared with investors: yes');
    expect(t).toContain('PageSpeed key on this deployment: set');
  });

  // Prompt 919 addendum (19/10/2026): without a key the feature is OFF for founders (no card, no check) — not "over quota" — and the back office is
  // the place that says so, in words, with the instruction; the forced check is switched off too (the route refuses it as well).
  it('a missing key is not a quiet line at the bottom: an alert says the feature is OFF for founders and what to do, and Force re-check is disabled', () => {
    const html = bo({ ...boOk, keyConfigured: false });
    expect(html).toContain('data-testid="wh-key-missing"');
    expect(html).toContain('role="alert"');
    const t = text(html);
    expect(t).toContain('Switched OFF for founders.');
    expect(t).toContain('PAGESPEED_API_KEY is not set on this deployment');
    expect(t).toContain('founders do not see this card and no check can run');
    expect(t).toContain('docs/ops/CONFIG_REGISTRY.md §1.4b');
    expect(t).toContain('PageSpeed key on this deployment: NOT SET — the check is off');
    expect(isDisabled(buttonOf(html, /Force re-check/))).toBe(true);
  });

  it('with the key set there is no alert and the button is enabled', () => {
    const html = bo(boOk);
    expect(html).not.toContain('wh-key-missing');
    expect(isDisabled(buttonOf(html, /Force re-check/))).toBe(false);
  });

  it('"Force re-check" is always there for a startup with a website (it ignores the 7 days); disabled while it runs, and for a startup with no website', () => {
    expect(isDisabled(buttonOf(bo(boOk), /Force re-check/))).toBe(false);
    expect(isDisabled(buttonOf(bo(boOk, { busy: true }), /Checking/))).toBe(true);
    const none = buttonOf(bo({ ...boOk, rawWebsite: null, website: null, latest: { mobile: null, desktop: null } }), /Force re-check/);
    expect(isDisabled(none)).toBe(true);
  });

  it('a website that is on file but is not a public address is labelled as such', () => {
    expect(text(bo({ ...boOk, rawWebsite: 'http://localhost:3000', website: null }))).toContain('not a public address');
  });

  it('tells the admin what the last click did', () => {
    expect(bo(boOk, { msg: 'Re-check done.' })).toContain('Re-check done.');
  });
});
