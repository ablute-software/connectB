// Prompt 919 — website health: Google's public PageSpeed / Lighthouse scores for a founder's own website. Pure rules only (no I/O); the
// call to Google lives in website-health-psi.ts, the orchestration in website-health-run.ts, the routes in api/website-health/*.
//
// This is NOT a signal about the startup. A pre-launch deeptech can have a poor site and an excellent team; nothing here (and nothing in
// the copy built on it) ever says otherwise. It is a technical reading of one public page, shown to the founder, and shown to an
// investor only when the founder turns it on.
//
// Everything below was written against REAL Lighthouse 13.5.0 results (src/lib/__fixtures__/pagespeed-*.json: one light page, one heavy
// one), and several decisions exist because the real data contradicts what one would assume:
//  · a page can score 100 for performance and still have "failed" insight audits with a score of 0 or 0.5 and ZERO potential savings
//    (example.com does). Listing every sub-0.9 audit would put noise on a perfect page, so a performance finding must have measurable
//    savings above a floor (PERF_MIN_*), and only the five largest are kept;
//  · the savings are expressed three different ways — per-metric milliseconds in `metricSavings` (TBT 1750), bytes in
//    `details.overallSavingsBytes`, or only inside the display text ("Est savings of 1,687 KiB", with a NON-BREAKING space between the
//    number and the unit) — so the ranking reads all three;
//  · the same audit can count in two categories (`image-alt` is in accessibility AND SEO), so findings are merged by audit id;
//  · audits in the group "hidden" are legacy/duplicate metrics Lighthouse itself does not show as findings; audits in `informative`,
//    `manual`, `notApplicable` and `error` modes are never findings (an `error` audit is Google failing to measure, not a site failing);
//  · INP is not a lab audit any more: it only exists as field data (loadingExperience), when Google has enough real visits;
//  · a 200 answer can carry `lighthouseResult.runtimeError` (the page could not be loaded): that is a failed analysis, not a 0 score.

export type WebsiteStrategy = 'mobile' | 'desktop';
export const WEBSITE_STRATEGIES: readonly WebsiteStrategy[] = ['mobile', 'desktop'];

export type FindingCategory = 'performance' | 'accessibility' | 'best-practices' | 'seo';
export const FINDING_CATEGORIES: readonly FindingCategory[] = ['performance', 'accessibility', 'best-practices', 'seo'];
export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best practices', seo: 'SEO',
};

export interface WebsiteScores { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null }
export interface WebsiteMetrics { lcpMs: number | null; cls: number | null; inpMs: number | null }

export interface WebsiteFinding {
  id: string; title: string; description: string; displayValue?: string;
  /** Every category this audit counts in (image-alt: accessibility + seo). */
  categories: FindingCategory[];
  /** Lighthouse's own weight for it (the highest across its categories): how much it costs the score. 0 = shown, not scored. */
  weight: number;
  /** Performance findings only: the measurable gain, in the unit Google gave it. */
  savings?: { ms?: number; bytes?: number };
}

export type WebsiteCheckErrorKind = 'quota' | 'key' | 'unreachable' | 'timeout' | 'network' | 'invalid_url' | 'unknown';
export interface WebsiteCheckError { kind: WebsiteCheckErrorKind; message: string; httpStatus?: number; code?: string }

/** What `org_website_audits.audits` holds: the essentials of a good analysis, or the reason a failed one failed. */
export type StoredAudits =
  | { items: WebsiteFinding[]; lighthouseVersion?: string; finalUrl?: string }
  | { error: WebsiteCheckError };

export const RECHECK_DAYS = 7;
export const FAILED_RETRY_MINUTES = 10;
/** A performance finding must be worth fixing: at least this much time or this many bytes. */
export const PERF_MIN_SAVINGS_MS = 100;
export const PERF_MIN_SAVINGS_BYTES = 50 * 1024;
export const PERF_MAX_FINDINGS = 5;
/** Lighthouse's own line between "fine" and "needs work" for a numeric audit. */
const NUMERIC_PASS_SCORE = 0.9;
/** The table refuses an audits blob over 60 KB; the reducer stays well under it. */
const MAX_FINDINGS = 40;
const MAX_STORED_BYTES = 45_000;

// ---------------------------------------------------------------------------------------------------------------------
// The address

/**
 * The address a check runs against, from what the founder typed in About › Company: https, no trailing slash, a real public host name.
 * Google fetches the page (we never do), so this is not an SSRF guard — it keeps nonsense out of the quota and the table: no
 * credentials, no IP literals, no localhost or one-label hosts, no odd ports.
 */
export function normalizeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (!text || text.length > 2000) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443' && url.port !== '80') return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return null;
  if (host === 'localhost' || /\.(local|localhost|internal|lan|home|corp|test|example|invalid)$/.test(host)) return null; // names that only exist on a private network, or are reserved (RFC 2606)
  const path = url.pathname.replace(/\/+$/, '');
  return `https://${host}${path}${url.search}`;
}

/** Google's own report page for a URL — the link under "All findings" and the one an investor gets (when the founder shares). */
export function pageSpeedReportUrl(url: string, strategy: WebsiteStrategy = 'mobile'): string {
  return `https://pagespeed.web.dev/report?url=${encodeURIComponent(url)}&form_factor=${strategy}`;
}

export function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Scores and their colours

export type ScoreBand = 'red' | 'orange' | 'green';
/** Google's scale, as the prompt states it: 0–49 red, 50–89 orange, 90–100 green. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return 'green';
  if (score >= 50) return 'orange';
  return 'red';
}
export const BAND_COLOR: Record<ScoreBand, { arc: string; text: string }> = {
  red: { arc: '#ff4e42', text: '#c5221f' },
  orange: { arc: '#ffa400', text: '#b06000' },
  green: { arc: '#0cce6b', text: '#0d652d' },
};

const SCORE_COLUMNS = { performance: 'score_performance', seo: 'score_seo', accessibility: 'score_accessibility', bestPractices: 'score_best_practices' } as const;
export { SCORE_COLUMNS };

function toScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.min(100, Math.max(0, Math.round(raw * 100)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading Google's answer

const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/ /g, ' ').trim().slice(0, max) : '');

interface RawAudit {
  id?: unknown; title?: unknown; description?: unknown; score?: unknown; scoreDisplayMode?: unknown; displayValue?: unknown;
  numericValue?: unknown; metricSavings?: unknown; details?: unknown;
}
interface RawRef { id?: unknown; weight?: unknown; group?: unknown }

/** Failed in Google's own terms: a measured audit that scored below its pass line. Informative / manual / not-applicable / error never are. */
export function isFailedAudit(a: RawAudit | undefined | null): boolean {
  if (!a || typeof a.score !== 'number' || !Number.isFinite(a.score)) return false;
  if (a.scoreDisplayMode === 'binary') return a.score < 1;
  if (a.scoreDisplayMode === 'numeric' || a.scoreDisplayMode === 'metricSavings') return a.score < NUMERIC_PASS_SCORE;
  return false;
}

/** "Est savings of 1,687 KiB" → bytes. Lighthouse puts a non-breaking space between the number and the unit. */
export function parseSavingsBytes(displayValue: unknown): number {
  const text = clean(displayValue, 200);
  const m = /savings of\s*([\d][\d,]*(?:\.\d+)?)\s*(KiB|MiB|GiB|B)\b/i.exec(text);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const unit = m[2].toLowerCase();
  return Math.round(n * (unit === 'gib' ? 1024 ** 3 : unit === 'mib' ? 1024 ** 2 : unit === 'kib' ? 1024 : 1));
}

function parseSavingsMs(displayValue: unknown): number {
  const m = /savings of\s*([\d][\d,]*(?:\.\d+)?)\s*(ms|s)\b/i.exec(clean(displayValue, 200));
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * (m[2].toLowerCase() === 's' ? 1000 : 1)) : 0;
}

/** What fixing a performance audit would gain, read from wherever Google put it. */
export function performanceSavings(a: RawAudit): { ms: number; bytes: number } {
  let ms = 0;
  if (a.metricSavings && typeof a.metricSavings === 'object') {
    // CLS savings are a unitless layout-shift score (0.05), not milliseconds: they never count as time saved.
    for (const [k, v] of Object.entries(a.metricSavings as Record<string, unknown>)) if (k !== 'CLS' && typeof v === 'number' && Number.isFinite(v) && v > ms) ms = v;
  }
  const d = (a.details ?? {}) as { overallSavingsMs?: unknown; overallSavingsBytes?: unknown };
  if (typeof d.overallSavingsMs === 'number' && d.overallSavingsMs > ms) ms = d.overallSavingsMs;
  if (ms === 0) ms = parseSavingsMs(a.displayValue);
  const bytes = typeof d.overallSavingsBytes === 'number' && d.overallSavingsBytes > 0 ? d.overallSavingsBytes : parseSavingsBytes(a.displayValue);
  return { ms: Math.round(ms), bytes: Math.round(bytes) };
}

function toFinding(a: RawAudit, category: FindingCategory, weight: number): WebsiteFinding | null {
  const id = clean(a.id, 100);
  const title = clean(a.title, 300);
  if (!id || !title) return null;
  const f: WebsiteFinding = { id, title, description: clean(a.description, 700), categories: [category], weight: Number.isFinite(weight) ? Math.round(weight * 100) / 100 : 0 };
  const dv = clean(a.displayValue, 160);
  if (dv) f.displayValue = dv;
  return f;
}

export interface ReducedAnalysis {
  scores: WebsiteScores; metrics: WebsiteMetrics; findings: WebsiteFinding[];
  lighthouseVersion?: string; finalUrl?: string; analysedAt: string | null;
}
export type ReduceResult = { ok: true; analysis: ReducedAnalysis } | { ok: false; error: WebsiteCheckError };

/**
 * Google's whole answer (hundreds of KB) → the essentials the table keeps: four scores, three web-vitals numbers, and the findings —
 * every failed audit of accessibility / best practices / SEO, and the largest few of performance. Never the whole report.
 */
export function reducePageSpeedResponse(json: unknown): ReduceResult {
  const root = (json ?? {}) as { lighthouseResult?: unknown; loadingExperience?: unknown; analysisUTCTimestamp?: unknown };
  const lh = root.lighthouseResult as {
    runtimeError?: { code?: unknown; message?: unknown }; categories?: Record<string, { score?: unknown; auditRefs?: RawRef[] }>;
    audits?: Record<string, RawAudit>; lighthouseVersion?: unknown; finalUrl?: unknown; fetchTime?: unknown;
  } | undefined;
  if (!lh || typeof lh !== 'object') return { ok: false, error: { kind: 'unknown', message: 'Google returned no report.' } };

  if (lh.runtimeError && typeof lh.runtimeError === 'object') {
    const code = clean(lh.runtimeError.code, 80);
    const kind: WebsiteCheckErrorKind = /TIMEOUT/i.test(code) ? 'timeout' : 'unreachable';
    return { ok: false, error: { kind, message: clean(lh.runtimeError.message, 300) || code || 'Google could not load the page.', ...(code ? { code } : {}) } };
  }

  const cats = lh.categories ?? {};
  const scores: WebsiteScores = {
    performance: toScore(cats.performance?.score), seo: toScore(cats.seo?.score),
    accessibility: toScore(cats.accessibility?.score), bestPractices: toScore(cats['best-practices']?.score),
  };
  if (Object.values(scores).every((s) => s === null)) {
    return { ok: false, error: { kind: 'unreachable', message: 'Google returned no scores for this page.' } };
  }

  const audits = lh.audits ?? {};
  const numeric = (id: string): number | null => {
    const v = audits[id]?.numericValue;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const lcp = numeric('largest-contentful-paint');
  const cls = numeric('cumulative-layout-shift');
  const field = (root.loadingExperience as { metrics?: Record<string, { percentile?: unknown }> } | undefined)?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile;
  const inp = typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : numeric('interaction-to-next-paint');
  const metrics: WebsiteMetrics = {
    lcpMs: lcp === null ? null : Math.round(lcp), cls: cls === null ? null : Math.round(cls * 10_000) / 10_000, inpMs: inp === null ? null : Math.round(inp),
  };

  // 1. accessibility / best practices / SEO: every failed audit that Lighthouse itself shows (not the "hidden" group), merged by id
  const byId = new Map<string, WebsiteFinding>();
  for (const category of ['accessibility', 'best-practices', 'seo'] as const) {
    for (const ref of cats[category]?.auditRefs ?? []) {
      if (ref.group === 'hidden') continue;
      const a = audits[String(ref.id)];
      if (!isFailedAudit(a)) continue;
      const weight = typeof ref.weight === 'number' ? ref.weight : 0;
      const existing = byId.get(String(ref.id));
      if (existing) {
        if (!existing.categories.includes(category)) existing.categories.push(category);
        existing.weight = Math.max(existing.weight, Math.round(weight * 100) / 100);
        continue;
      }
      const f = toFinding(a as RawAudit, category, weight);
      if (f) byId.set(f.id, f);
    }
  }

  // 2. performance: the largest few, by what fixing them would gain; the headline metrics have their own columns, "hidden" ones are legacy
  const perf: { f: WebsiteFinding; ms: number; bytes: number }[] = [];
  for (const ref of cats.performance?.auditRefs ?? []) {
    if (ref.group === 'metrics' || ref.group === 'hidden') continue;
    const a = audits[String(ref.id)];
    if (!isFailedAudit(a)) continue;
    const { ms, bytes } = performanceSavings(a as RawAudit);
    if (ms < PERF_MIN_SAVINGS_MS && bytes < PERF_MIN_SAVINGS_BYTES) continue;
    const f = toFinding(a as RawAudit, 'performance', typeof ref.weight === 'number' ? ref.weight : 0);
    if (!f) continue;
    f.savings = { ...(ms > 0 ? { ms } : {}), ...(bytes > 0 ? { bytes } : {}) };
    perf.push({ f, ms, bytes });
  }
  // Time first (what slows the page), then bytes; a gain in milliseconds outranks any number of bytes.
  perf.sort((x, y) => (y.ms >= PERF_MIN_SAVINGS_MS ? 1 : 0) - (x.ms >= PERF_MIN_SAVINGS_MS ? 1 : 0) || y.ms - x.ms || y.bytes - x.bytes || x.f.id.localeCompare(y.f.id));
  const perfFindings = perf.slice(0, PERF_MAX_FINDINGS).map((p) => p.f);

  // 3. one list: performance first (already by impact), then the others by Lighthouse's own weight; an audit shared with performance keeps one entry
  const rest = [...byId.values()].filter((f) => !perfFindings.some((p) => p.id === f.id))
    .sort((x, y) => y.weight - x.weight || FINDING_CATEGORIES.indexOf(x.categories[0]) - FINDING_CATEGORIES.indexOf(y.categories[0]) || x.id.localeCompare(y.id));
  let findings = [...perfFindings, ...rest].slice(0, MAX_FINDINGS);
  while (findings.length > 1 && JSON.stringify(findings).length > MAX_STORED_BYTES) findings = findings.slice(0, -1);

  return {
    ok: true,
    analysis: {
      scores, metrics, findings,
      lighthouseVersion: clean(lh.lighthouseVersion, 40) || undefined,
      finalUrl: clean(lh.finalUrl, 2000) || undefined,
      analysedAt: clean(root.analysisUTCTimestamp, 60) || clean(lh.fetchTime, 60) || null,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// When Google says no

const KEY_REASONS = /keyinvalid|api_key_invalid|api_key_http_referrer_blocked|api_key_ip_address_blocked|api_key_service_blocked|service_disabled|accessnotconfigured|permission_denied|ipRefererBlocked|forbidden/i;
const QUOTA_REASONS = /ratelimitexceeded|rate_limit_exceeded|quotaexceeded|dailylimitexceeded|resource_exhausted/i;

/** An HTTP failure from the PageSpeed API → what kind of failure it is, in terms of what the founder (or the platform) can do about it. */
export function classifyPageSpeedHttpError(httpStatus: number, bodyText: string): WebsiteCheckError {
  let message = '';
  let signals = '';
  try {
    const body = JSON.parse(bodyText) as { error?: { message?: unknown; status?: unknown; errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] } };
    message = clean(body.error?.message, 300);
    signals = [body.error?.status, ...(body.error?.errors ?? []).map((e) => e.reason), ...(body.error?.details ?? []).map((d) => d.reason)].filter((x) => typeof x === 'string').join(' ');
  } catch { message = clean(bodyText, 300); }
  const base = { message: message || `HTTP ${httpStatus}`, httpStatus };
  if (httpStatus === 429 || QUOTA_REASONS.test(signals)) return { kind: 'quota', ...base };
  if (KEY_REASONS.test(signals) || /api key|referer|referrer|not been used|is disabled/i.test(message) || httpStatus === 401 || httpStatus === 403) return { kind: 'key', ...base };
  if (/lighthouse returned error|FAILED_DOCUMENT_REQUEST|NO_FCP|unable to reliably load|lighthouseerror/i.test(`${message} ${signals}`)) return { kind: 'unreachable', ...base };
  if (httpStatus === 400) return { kind: 'invalid_url', ...base };
  // Any other 5xx is Google's own trouble, not a site that will not load: it must not tell the founder to "check it loads publicly".
  return { kind: 'unknown', ...base };
}

/** What the founder reads for each kind of failure. The raw Google message is for the back office, never for the founder. */
export function websiteCheckErrorCopy(kind: WebsiteCheckErrorKind): string {
  switch (kind) {
    case 'unreachable': return "Google couldn't analyse this URL — check it loads publicly";
    case 'timeout': return 'Google took too long to analyse this URL. Try again in a few minutes.';
    case 'quota': return "Google's free quota for this check is used up right now. Try again later.";
    case 'key': return "Website checks aren't available right now. Try again later.";
    case 'network': return "We couldn't reach Google just now. Try again in a few minutes.";
    case 'invalid_url': return "That doesn't look like a public website address — fix it in About › Company.";
    default: return 'Something went wrong with the check. Try again in a few minutes.';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// What is stored, and the rate limit

export interface StoredRowLike {
  strategy: WebsiteStrategy; url: string; fetched_at: string;
  score_performance: number | null; score_seo: number | null; score_accessibility: number | null; score_best_practices: number | null;
  lcp_ms?: number | null; cls?: number | string | null; inp_ms?: number | null;
  audits?: unknown; summary?: string | null; summary_model?: string | null; summary_credits?: number | null; id?: string;
}

export const hasScores = (r: Pick<StoredRowLike, 'score_performance' | 'score_seo' | 'score_accessibility' | 'score_best_practices'>): boolean =>
  r.score_performance !== null || r.score_seo !== null || r.score_accessibility !== null || r.score_best_practices !== null;

/** The row to store for an analysis that worked (one per strategy). */
export function successRow(orgId: string, url: string, strategy: WebsiteStrategy, a: ReducedAnalysis, fetchedAt: string) {
  const audits: StoredAudits = { items: a.findings, ...(a.lighthouseVersion ? { lighthouseVersion: a.lighthouseVersion } : {}), ...(a.finalUrl ? { finalUrl: a.finalUrl } : {}) };
  return {
    org_id: orgId, url, strategy, fetched_at: fetchedAt,
    score_performance: a.scores.performance, score_seo: a.scores.seo, score_accessibility: a.scores.accessibility, score_best_practices: a.scores.bestPractices,
    lcp_ms: a.metrics.lcpMs, cls: a.metrics.cls, inp_ms: a.metrics.inpMs, audits,
  };
}
/** The row to store for one that failed: null scores, and the reason. */
export function failureRow(orgId: string, url: string, strategy: WebsiteStrategy, error: WebsiteCheckError, fetchedAt: string) {
  const audits: StoredAudits = { error };
  return {
    org_id: orgId, url, strategy, fetched_at: fetchedAt,
    score_performance: null, score_seo: null, score_accessibility: null, score_best_practices: null,
    lcp_ms: null, cls: null, inp_ms: null, audits,
  };
}

export function readStoredAudits(raw: unknown): { findings: WebsiteFinding[]; error: WebsiteCheckError | null; lighthouseVersion?: string; finalUrl?: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { items?: unknown; error?: unknown; lighthouseVersion?: unknown; finalUrl?: unknown };
  const err = o.error && typeof o.error === 'object' ? (o.error as Partial<WebsiteCheckError>) : null;
  const kinds: WebsiteCheckErrorKind[] = ['quota', 'key', 'unreachable', 'timeout', 'network', 'invalid_url', 'unknown'];
  const error = err ? { kind: kinds.includes(err.kind as WebsiteCheckErrorKind) ? (err.kind as WebsiteCheckErrorKind) : 'unknown', message: clean(err.message, 300), ...(typeof err.httpStatus === 'number' ? { httpStatus: err.httpStatus } : {}), ...(typeof err.code === 'string' ? { code: err.code } : {}) } : null;
  const findings = Array.isArray(o.items) ? (o.items as WebsiteFinding[]).filter((f) => f && typeof f.id === 'string' && typeof f.title === 'string') : [];
  return { findings, error, lighthouseVersion: typeof o.lighthouseVersion === 'string' ? o.lighthouseVersion : undefined, finalUrl: typeof o.finalUrl === 'string' ? o.finalUrl : undefined };
}

export type CheckBlock = 'no_website' | 'too_soon' | 'cooldown';
export interface CheckAllowance { allowed: boolean; reason?: CheckBlock; nextCheckAt?: string }

/**
 * One analysis per org per 7 days — for the same address: a founder who fixes a typo in the website gets an immediate check, and a
 * failed attempt does not burn the week (Google being down is not the founder's check) — it only waits FAILED_RETRY_MINUTES so a broken
 * address cannot hammer the quota. `force` is the back office's.
 */
export function checkAllowance(rows: Pick<StoredRowLike, 'url' | 'fetched_at' | 'score_performance' | 'score_seo' | 'score_accessibility' | 'score_best_practices'>[],
  url: string | null, now: Date, opts: { force?: boolean } = {}): CheckAllowance {
  if (!url) return { allowed: false, reason: 'no_website' };
  if (opts.force) return { allowed: true };
  const same = rows.filter((r) => r.url === url);
  const latestOk = same.filter(hasScores).map((r) => Date.parse(r.fetched_at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (latestOk !== undefined) {
    const next = latestOk + RECHECK_DAYS * 86_400_000;
    if (next > now.getTime()) return { allowed: false, reason: 'too_soon', nextCheckAt: new Date(next).toISOString() };
  }
  const latestAny = same.map((r) => Date.parse(r.fetched_at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (latestAny !== undefined && (latestOk === undefined || latestAny > latestOk)) {
    const next = latestAny + FAILED_RETRY_MINUTES * 60_000;
    if (next > now.getTime()) return { allowed: false, reason: 'cooldown', nextCheckAt: new Date(next).toISOString() };
  }
  return { allowed: true };
}

/** The most recent row of each strategy. */
export function latestByStrategy<T extends Pick<StoredRowLike, 'strategy' | 'fetched_at'>>(rows: T[]): Record<WebsiteStrategy, T | null> {
  const out: Record<WebsiteStrategy, T | null> = { mobile: null, desktop: null };
  for (const r of rows) {
    const cur = out[r.strategy];
    if (!cur || Date.parse(r.fetched_at) > Date.parse(cur.fetched_at)) out[r.strategy] = r;
  }
  return out;
}

/** The row an AI summary describes (and is stored on): the mobile one, or the desktop one when mobile has no scores. */
export function primaryRow<T extends Pick<StoredRowLike, 'strategy' | 'score_performance' | 'score_seo' | 'score_accessibility' | 'score_best_practices'>>(latest: Record<WebsiteStrategy, T | null>): T | null {
  if (latest.mobile && hasScores(latest.mobile)) return latest.mobile;
  if (latest.desktop && hasScores(latest.desktop)) return latest.desktop;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The investor's view — only when the founder opted in, only the scores

export interface WebsiteHealthPublic {
  scores: { performance: number; seo: number; accessibility: number; bestPractices: number };
  strategy: 'mobile'; checkedAt: string; reportUrl: string;
}
export type InvestorAuditRow = Pick<StoredRowLike, 'url' | 'fetched_at' | 'score_performance' | 'score_seo' | 'score_accessibility' | 'score_best_practices'>;
/** The ONLY columns the dossier query selects from org_website_audits: no `audits`, no `summary`, nothing a founder has not agreed to show. */
export const INVESTOR_AUDIT_COLUMNS = 'url, fetched_at, score_performance, score_seo, score_accessibility, score_best_practices';

const isScore = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;

/**
 * Prompt 919 D. Present ONLY when the founder switched it on AND a mobile analysis with all four scores exists. Four numbers, a date and
 * Google's own report link — never the summary, never a finding, never a verdict (no colour, no "good"/"poor", no comparison). The row
 * type has no summary and no audits on purpose: the dossier query does not select them, so they cannot leak from here.
 */
export function projectWebsiteHealthForInvestor(visible: boolean, row: InvestorAuditRow | null | undefined): WebsiteHealthPublic | null {
  if (visible !== true || !row) return null;
  const { score_performance: p, score_seo: s, score_accessibility: a, score_best_practices: b } = row;
  if (!isScore(p) || !isScore(s) || !isScore(a) || !isScore(b)) return null;
  const url = normalizeWebsiteUrl(row.url);
  if (!url || Number.isNaN(Date.parse(row.fetched_at))) return null;
  return { scores: { performance: p, seo: s, accessibility: a, bestPractices: b }, strategy: 'mobile', checkedAt: row.fetched_at, reportUrl: pageSpeedReportUrl(url, 'mobile') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Text

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Oct" (and the year when it is not this year), in UTC so every reader sees the same day. */
export function formatCheckedDate(iso: string | null | undefined, now: Date = new Date()): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '';
  const base = `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
  return t.getUTCFullYear() === now.getUTCFullYear() ? base : `${base} ${t.getUTCFullYear()}`;
}

export type TextSegment = { type: 'text'; value: string } | { type: 'code'; value: string } | { type: 'link'; label: string; href: string };

/**
 * Google writes its titles and descriptions in a little markdown: `code` and [label](https://…). They are shown "as they come" — but as
 * readable text and real links, not as raw punctuation. Only http(s) links survive; everything else stays as plain text.
 */
export function parseLighthouseText(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const splitCode = (chunk: string) => {
    const parts = chunk.split('`');
    parts.forEach((p, i) => { if (p) out.push(i % 2 === 1 && i < parts.length - 1 ? { type: 'code', value: p } : { type: 'text', value: i % 2 === 1 ? `\`${p}` : p }); });
  };
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) splitCode(text.slice(last, m.index));
    out.push({ type: 'link', label: m[1].replace(/`/g, ''), href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) splitCode(text.slice(last));
  return out;
}
