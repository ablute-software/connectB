// Prompt 929 (B) — the internal engine of the tips Sherlock Deal may send to an applicant who was NOT selected after being evaluated. Pure and deterministic; NO AI, no external call, no randomness.
//
//   1. INPUT: how this application did on each criterion (the average of the evaluators, as a percentage of that criterion's own scale), how the SELECTED applications of the same call did on average, the weight of
//      each criterion, and what was missing from the form (optional documents left empty, very short answers). It never receives a comment, a private note, the name of an evaluator or the name of a criterion's score.
//   2. It picks the WEAKEST areas: the criteria where the application is furthest below the selected ones, weighted by the criterion's weight — at most 3.
//   3. Each criterion is linked to a general CATEGORY by the words of its name and guidance (Portuguese and English); a criterion that cannot be linked to any category is not used. Each category has model sentences
//      written for the applicant (tips-templates.ts), in the language of the call.
//   4. OUTPUT: only the categories and the sentences. NEVER a score, a position, an average, the number of criteria, a name of a criterion, an evaluator or a comment.
//   5. With fewer than 2 submitted evaluations, no comparison possible, or no clear point, there are NO tips (the applicant then gets, with consent, only the general invitation).
import { CATEGORIES, KEYWORDS, SENTENCES, type TipCategory, type TipLanguage } from './tips-templates';

export const MAX_TIPS = 3;
/** A gap smaller than this (percentage points of the scale, before the weight) is not "a clear point". */
export const MIN_GAP_POINTS = 5;
/** Fewer submitted evaluations than this: not enough to say anything about an application. */
export const MIN_EVALUATIONS = 2;

export interface TipCriterion { id: string; name: string; guidance?: string | null; /** The weight in percent when the call is weighted; ignored (all equal) otherwise. */ weight: number }
export interface TipsInput {
  language: TipLanguage; applicationId: string;
  criteria: TipCriterion[];
  /** This application: the average of the evaluators on each criterion, as a percentage of the scale (0–100). */
  mine: Record<string, number>;
  /** The selected applications of the same call: the average, per criterion, of the same percentage. */
  selected: Record<string, number>;
  selectedCount: number;
  submittedEvaluations: number;
  weighted: boolean;
  /** What the form shows was missing: optional document questions left empty, and long answers that are very short. */
  missingOptionalDocuments: number; shortAnswers: number;
}
export type TipsReason = 'ok' | 'not_enough_evaluations' | 'no_comparison' | 'no_clear_points';
export interface TipsResult { reason: TipsReason; categories: TipCategory[]; sentences: string[] }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The category a criterion belongs to, from the words of its name and guidance in either language: the one with most hits (the earlier category on a tie); null when none matches. */
export function categoryOf(criterion: Pick<TipCriterion, 'name' | 'guidance'>): TipCategory | null {
  const text = ` ${fold(`${criterion.name} ${criterion.guidance ?? ''}`)} `;
  let best: TipCategory | null = null; let bestHits = 0;
  for (const cat of CATEGORIES) {
    let hits = 0;
    for (const w of [...KEYWORDS[cat].en, ...KEYWORDS[cat].pt]) if (text.includes(fold(w))) hits += fold(w).length >= 5 ? 2 : 1;      // a longer stem is stronger evidence than a short word
    if (hits > bestHits) { best = cat; bestHits = hits; }
  }
  return best;
}

/** A small stable hash, so the same application always gets the same model sentence of a category. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function sentenceFor(category: TipCategory, language: TipLanguage, applicationId: string): string {
  const options = SENTENCES[category][language];
  return options[hash(`${applicationId}|${category}`) % options.length];
}

export function chooseTips(input: TipsInput): TipsResult {
  const none = (reason: TipsReason): TipsResult => ({ reason, categories: [], sentences: [] });
  if (input.submittedEvaluations < MIN_EVALUATIONS) return none('not_enough_evaluations');
  if (input.selectedCount < 1) return none('no_comparison');

  const gaps = new Map<TipCategory, number>();
  for (const c of input.criteria) {
    const mine = input.mine[c.id]; const sel = input.selected[c.id];
    if (typeof mine !== 'number' || typeof sel !== 'number') continue;
    const gap = sel - mine;
    if (gap < MIN_GAP_POINTS) continue;
    const category = categoryOf(c);
    if (!category) continue;                                                              // it cannot be linked to a general category: this point is not used
    const weight = input.weighted ? Math.max(c.weight, 1) : 1;
    gaps.set(category, Math.max(gaps.get(category) ?? 0, gap * weight));                    // two criteria of one category count once, by the larger gap
  }
  // what the form itself shows (lowest priority: it only fills a free place)
  if (input.missingOptionalDocuments > 0 || input.shortAnswers >= 3) gaps.set('documentation', Math.max(gaps.get('documentation') ?? 0, 0.5));

  const ranked = [...gaps.entries()].sort((a, b) => b[1] - a[1] || CATEGORIES.indexOf(a[0]) - CATEGORIES.indexOf(b[0])).slice(0, MAX_TIPS);
  if (ranked.length === 0) return none('no_clear_points');
  const categories = ranked.map(([c]) => c);
  return { reason: 'ok', categories, sentences: categories.map((c) => sentenceFor(c, input.language, input.applicationId)) };
}
