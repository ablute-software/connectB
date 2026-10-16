// Prompt 919 B — the plain-language reading of a website's Google scores, written for a founder who is not an engineer. Pure: the
// request the model gets, and — the part that matters — what is allowed to come back out of it. The call, the charge and the storage are
// in website-health-run.ts and the route.
//
// The model never decides what exists. It receives the four scores, the web-vitals and the list of failed audits exactly as Google
// reported them, and it may only talk about those: every "fix first" item must cite audit ids from that list (an item that cites none
// that exist is dropped), a link it writes must come from the text of the audit it cites, and "doing well" may only praise a category
// that really scores 90 or more. Nothing here, in the prompt or in the validation, lets the result say anything about the founder or the
// team — the score is a measurement of one public page, not of the people behind it.
import { wrapDocumentContent, DOCUMENT_CONTENT_INSTRUCTION } from './prompt-injection-defense';
import {
  CATEGORY_LABEL, FINDING_CATEGORIES, type FindingCategory, type WebsiteFinding, type WebsiteMetrics, type WebsiteScores, type WebsiteStrategy,
} from './website-health';

/** The cheapest model of the family in use in the project (classify-ai.ts uses the same one). */
export const WEBSITE_SUMMARY_MODEL = 'claude-haiku-4-5';
/** Prompt 919 B.2: the whole input — instructions, tool, scores, findings — stays under 6k tokens. */
export const SUMMARY_INPUT_TOKEN_CAP = 6000;
export const SUMMARY_MAX_OUTPUT_TOKENS = 1000;
export const SUMMARY_TOOL_NAME = 'report_website_summary';

/** Same coarse estimate the rest of the project uses for budgets (company-badge-verification.ts): 4 characters a token. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface WebsiteSummary {
  v: 1;
  headline: string;
  fixFirst: { auditIds: string[]; what: string; whyItMatters: string; how: string }[];
  doingWell: { category: FindingCategory; text: string }[];
}

export const SUMMARY_SYSTEM_PROMPT =
  'You explain the public Google PageSpeed results of ONE startup website to its founder, who is not an engineer. '
  + 'You are given the four category scores (0–100), a few load-time numbers, and the list of audits Google reported as failed — nothing else. '
  + 'Use ONLY that. Never invent an audit, a number, a score or a link, and never claim to have looked at the site yourself. '
  + 'Write short, calm, specific sentences in plain words: no jargon (say "how fast the main content appears", not "LCP"), no blame, no alarm. '
  + 'headline: ONE sentence on where the site stands. '
  + 'fix_first: at most 3 items, the ones that would help most for the least effort, taken only from the list. For each, cite the audit id(s) '
  + 'from the list in audit_ids, say WHAT is wrong in plain words, WHY it matters (to visitors, or to being found on Google), and HOW to start '
  + '(something the founder can do or hand to a developer in one sentence). If the list is empty, return an empty fix_first and a headline that says nothing needs fixing. '
  + 'doing_well: at most 2 items, each naming ONE of the four categories that scores 90 or more and saying in a sentence what that means for visitors; '
  + 'if no category scores 90 or more, return an empty doing_well. '
  + 'This is a measurement of one public web page, never of the company or the people behind it: do not say anything about the founder, the team '
  + 'or the company\'s quality or attention, do not compare with other companies, and do not call the site good or bad as a verdict on the startup. '
  + DOCUMENT_CONTENT_INSTRUCTION;

export const SUMMARY_TOOL = {
  name: SUMMARY_TOOL_NAME,
  description: 'Report the plain-language reading of the website health results.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One sentence on where the site stands.' },
      fix_first: {
        type: 'array', maxItems: 3,
        items: {
          type: 'object',
          properties: {
            audit_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'Ids copied exactly from the list of failed audits.' },
            what: { type: 'string', description: 'What is wrong, in plain words.' },
            why_it_matters: { type: 'string', description: 'Why it matters to visitors or to being found on Google.' },
            how: { type: 'string', description: 'How to start fixing it, in one sentence.' },
          },
          required: ['audit_ids', 'what', 'why_it_matters', 'how'],
        },
      },
      doing_well: {
        type: 'array', maxItems: 2,
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['performance', 'seo', 'accessibility', 'best-practices'] },
            text: { type: 'string', description: 'One sentence on what that good score means for visitors.' },
          },
          required: ['category', 'text'],
        },
      },
    },
    required: ['headline', 'fix_first', 'doing_well'],
  },
} as const;

export interface SummaryInput { website: string; strategy: WebsiteStrategy; scores: WebsiteScores; metrics: WebsiteMetrics; findings: WebsiteFinding[] }

const fmtScore = (n: number | null) => (n === null ? 'not available' : String(n));
function describeSavings(s: WebsiteFinding['savings']): string {
  if (!s) return '';
  const parts: string[] = [];
  if (s.ms) parts.push(s.ms >= 1000 ? `about ${(s.ms / 1000).toFixed(1)} s faster` : `about ${s.ms} ms faster`);
  if (s.bytes) parts.push(s.bytes >= 1024 * 1024 ? `about ${(s.bytes / (1024 * 1024)).toFixed(1)} MB less to download` : `about ${Math.round(s.bytes / 1024)} KB less to download`);
  return parts.join(', ');
}
const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

export function findingLine(f: WebsiteFinding): string {
  const impact = describeSavings(f.savings);
  return `- ${f.id} | ${f.categories.map((c) => CATEGORY_LABEL[c]).join(' + ')}${impact ? ` | ${impact}` : ''} | ${oneLine(f.title, 160)} | Google says: ${oneLine(f.description, 300)}${f.displayValue ? ` (${oneLine(f.displayValue, 80)})` : ''}`;
}

/**
 * The whole request, with the list of audits cut to the budget (the lowest-priority ones go first — the list arrives already ordered:
 * performance by impact, then everything else by Lighthouse's own weight). `findingsSent` tells the caller how many fit.
 */
export function buildSummaryRequest(input: SummaryInput, model: string = WEBSITE_SUMMARY_MODEL): {
  body: Record<string, unknown>; estimatedInputTokens: number; findingsSent: number; findingsTotal: number;
} {
  const head = [
    `Website: ${input.website} (analysed as ${input.strategy === 'mobile' ? 'a phone' : 'a desktop computer'})`,
    `Scores out of 100 — performance: ${fmtScore(input.scores.performance)}, SEO: ${fmtScore(input.scores.seo)}, accessibility: ${fmtScore(input.scores.accessibility)}, best practices: ${fmtScore(input.scores.bestPractices)}.`,
    `Colour bands Google uses: 0–49 poor, 50–89 needs improvement, 90–100 good.`,
    `Load-time numbers — main content appears after: ${input.metrics.lcpMs === null ? 'n/a' : `${input.metrics.lcpMs} ms`}; layout shift: ${input.metrics.cls === null ? 'n/a' : input.metrics.cls}; response to taps and clicks: ${input.metrics.inpMs === null ? 'n/a (not enough real-visitor data)' : `${input.metrics.inpMs} ms`}.`,
    'Failed audits, as Google reported them (id | category | gain if fixed | title | what Google says):',
  ].join('\n');

  const fixedTokens = estimateTokens(SUMMARY_SYSTEM_PROMPT + JSON.stringify(SUMMARY_TOOL) + head + wrapDocumentContent('')) + 40;
  let budget = SUMMARY_INPUT_TOKEN_CAP - fixedTokens;
  const lines: string[] = [];
  for (const f of input.findings) {
    const line = findingLine(f);
    const cost = estimateTokens(line) + 1;
    if (cost > budget) break;
    lines.push(line);
    budget -= cost;
  }
  const list = lines.length > 0 ? lines.join('\n') : '(none — Google reported no failed audits worth listing)';
  const userText = `${head}\n${wrapDocumentContent(list)}`;
  return {
    body: {
      model, max_tokens: SUMMARY_MAX_OUTPUT_TOKENS, system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
      tools: [SUMMARY_TOOL], tool_choice: { type: 'tool', name: SUMMARY_TOOL_NAME },
    },
    estimatedInputTokens: fixedTokens + estimateTokens(list),
    findingsSent: lines.length, findingsTotal: input.findings.length,
  };
}

export function parseSummaryToolUse(content: unknown[]): unknown | null {
  const block = (content as { type?: string; name?: string; input?: unknown }[]).filter((b) => b?.type === 'tool_use' && b.name === SUMMARY_TOOL_NAME).pop();
  return block ? block.input ?? null : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// What may come out

const MAX_HEADLINE = 240;
const MAX_FIELD = 420;
const MAX_PRAISE = 240;
/** Adjectives that grade people. The score measures a web page; none of these may land on a founder or a team, in any phrasing. */
const PEOPLE_VERDICT = /\b(attentive|inattentive|careless|sloppy|lazy|negligent|diligent|conscientious|competent|incompetent|unprofessional|amateur(?:ish)?|trustworthy|untrustworthy|reliable founder)\b/i;
const URL_RE = /https?:\/\/[^\s)\]>"']+/gi;
/** The headline and the praise cite no audit, so there is nothing for a link in them to be grounded in. */
const HAS_URL = /https?:\/\/|\bwww\./i;

const SCORE_OF: Record<FindingCategory, keyof WebsiteScores> = { performance: 'performance', seo: 'seo', accessibility: 'accessibility', 'best-practices': 'bestPractices' };

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t || PEOPLE_VERDICT.test(t)) return null;
  return t.slice(0, max);
}

/**
 * The tool's answer → the summary we store, or null when it has no usable headline. Item by item: an unusable item is dropped, never
 * repaired. The grounding rules are in this file's header; each is a line below.
 */
export function validateWebsiteSummary(raw: unknown, findings: WebsiteFinding[], scores: WebsiteScores): WebsiteSummary | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as { headline?: unknown; fix_first?: unknown; doing_well?: unknown } | null;
  if (!o) return null;
  const headline = text(o.headline, MAX_HEADLINE);
  if (!headline || HAS_URL.test(headline)) return null;

  const byId = new Map(findings.map((f) => [f.id, f]));
  const fixFirst: WebsiteSummary['fixFirst'] = [];
  for (const item of Array.isArray(o.fix_first) ? o.fix_first : []) {
    if (fixFirst.length >= 3) break;
    const i = item as { audit_ids?: unknown; what?: unknown; why_it_matters?: unknown; how?: unknown };
    const ids = [...new Set((Array.isArray(i.audit_ids) ? i.audit_ids : []).filter((x): x is string => typeof x === 'string' && byId.has(x)))].slice(0, 3);
    const what = text(i.what, MAX_FIELD); const why = text(i.why_it_matters, MAX_FIELD); const how = text(i.how, MAX_FIELD);
    if (ids.length === 0 || !what || !why || !how) continue;
    // a link is allowed only if Google wrote it in the audit being cited
    const allowed = new Set(ids.flatMap((id) => (byId.get(id)!.description.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, ''))));
    const written = `${what} ${why} ${how}`.match(URL_RE) ?? [];
    if (written.some((u) => !allowed.has(u.replace(/[.,;]+$/, '')))) continue;
    fixFirst.push({ auditIds: ids, what, whyItMatters: why, how });
  }

  const doingWell: WebsiteSummary['doingWell'] = [];
  for (const item of Array.isArray(o.doing_well) ? o.doing_well : []) {
    if (doingWell.length >= 2) break;
    const i = item as { category?: unknown; text?: unknown };
    const category = FINDING_CATEGORIES.find((c) => c === i.category);
    const t = text(i.text, MAX_PRAISE);
    const score = category ? scores[SCORE_OF[category]] : null;
    if (!category || !t || HAS_URL.test(t) || score === null || score < 90 || doingWell.some((d) => d.category === category)) continue;
    doingWell.push({ category, text: t });
  }

  return { v: 1, headline, fixFirst, doingWell };
}

export const serializeSummary = (s: WebsiteSummary): string => JSON.stringify(s);

/** What is stored in `summary` back into a summary — or null if it is empty or not one of ours (never trusts the column). */
export function readStoredSummary(stored: string | null | undefined): WebsiteSummary | null {
  if (!stored) return null;
  try {
    const s = JSON.parse(stored) as Partial<WebsiteSummary>;
    if (s?.v !== 1 || typeof s.headline !== 'string' || !Array.isArray(s.fixFirst) || !Array.isArray(s.doingWell)) return null;
    return s as WebsiteSummary;
  } catch { return null; }
}
