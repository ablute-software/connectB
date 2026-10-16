// Prompt 919 C — what the founder's "Website health" card is given, built from the stored rows: pure, so the card, the routes and the
// back office read one definition. It carries the founder-safe wording of every failure (never Google's raw message — that is for the back
// office) and the summary already parsed; it never carries the AI model's raw output or anything from a row that is not this website's.
import {
  checkAllowance, hasScores, latestByStrategy, normalizeWebsiteUrl, pageSpeedReportUrl, primaryRow, readStoredAudits, websiteCheckErrorCopy,
  type CheckAllowance, type StoredRowLike, type WebsiteCheckError, type WebsiteCheckErrorKind, type WebsiteFinding, type WebsiteMetrics, type WebsiteScores, type WebsiteStrategy,
} from './website-health';
import { readStoredSummary, type WebsiteSummary } from './website-health-summary';

export interface WebsiteAnalysisView {
  strategy: WebsiteStrategy; url: string; fetchedAt: string;
  scores: WebsiteScores; metrics: WebsiteMetrics; findings: WebsiteFinding[];
  /** Set when this analysis failed: the reason in words the founder can act on. */
  error: { kind: WebsiteCheckErrorKind; copy: string } | null;
  lighthouseVersion?: string; finalUrl?: string; reportUrl: string;
}

export interface WebsiteHealthState {
  ok: true; available: true;
  /** The address checks run against (normalised), or null when About › Company has none / a bad one. */
  website: string | null;
  websiteProblem: 'none' | 'missing' | 'invalid';
  analyses: Record<WebsiteStrategy, WebsiteAnalysisView | null>;
  summary: WebsiteSummary | null;
  /** Which check the summary describes (and is stored on): the phone one, or the desktop one when the phone check has no scores. */
  summaryStrategy: WebsiteStrategy | null;
  /** An analysis with scores exists and has no summary yet: the card offers "Get the summary". */
  summaryOffered: boolean;
  allowance: CheckAllowance;
  visibleToInvestors: boolean;
}

function view(row: StoredRowLike): WebsiteAnalysisView {
  const stored = readStoredAudits(row.audits);
  const cls = typeof row.cls === 'string' ? Number(row.cls) : row.cls ?? null;
  const failed = !hasScores(row);
  const error = failed ? (stored.error ?? { kind: 'unknown' as const, message: '' }) : null;
  return {
    strategy: row.strategy, url: row.url, fetchedAt: row.fetched_at,
    scores: { performance: row.score_performance, seo: row.score_seo, accessibility: row.score_accessibility, bestPractices: row.score_best_practices },
    metrics: { lcpMs: row.lcp_ms ?? null, cls: Number.isFinite(cls as number) ? (cls as number) : null, inpMs: row.inp_ms ?? null },
    findings: stored.findings,
    error: error ? { kind: error.kind, copy: websiteCheckErrorCopy(error.kind) } : null,
    ...(stored.lighthouseVersion ? { lighthouseVersion: stored.lighthouseVersion } : {}),
    ...(stored.finalUrl ? { finalUrl: stored.finalUrl } : {}),
    reportUrl: pageSpeedReportUrl(row.url, row.strategy),
  };
}

export function buildFounderState(input: { website: string | null | undefined; visible: boolean | null | undefined; rows: StoredRowLike[]; now: Date }): WebsiteHealthState {
  const typed = (input.website ?? '').trim();
  const website = normalizeWebsiteUrl(typed);
  const websiteProblem = !typed ? 'missing' : website ? 'none' : 'invalid';

  // Only what was measured on THIS address: a founder who changed the website must not see the old one's scores as if they were the new one's.
  const rowsForSite = website ? input.rows.filter((r) => r.url === website) : [];
  const latest = latestByStrategy(rowsForSite);
  const primary = primaryRow(latest);
  const summary = readStoredSummary(primary?.summary);

  return {
    ok: true, available: true, website, websiteProblem,
    analyses: { mobile: latest.mobile ? view(latest.mobile) : null, desktop: latest.desktop ? view(latest.desktop) : null },
    summary, summaryStrategy: primary?.strategy ?? null, summaryOffered: !!primary && !summary,
    allowance: checkAllowance(input.rows, website, input.now),
    visibleToInvestors: input.visible === true,
  };
}

/** The columns a founder-side read selects: everything the card shows, and nothing it does not (the summary text is parsed above). */
export const FOUNDER_ROW_COLUMNS =
  'id, url, strategy, score_performance, score_seo, score_accessibility, score_best_practices, lcp_ms, cls, inp_ms, audits, fetched_at, summary, summary_model, summary_credits';

export type { WebsiteCheckError };
