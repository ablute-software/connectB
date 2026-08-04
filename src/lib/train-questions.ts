// Prompt 115 Block F — Train question bank + session composition. Pure
// functions, no I/O, unit-tested — the non-repeating guarantee is math
// (deterministic, indexed by how many sessions have run so far), never
// Math.random(), per the prompt's own wording.
import type { CompanyFactCategory } from './types';

export type QuestionSource = 'fixed' | 'derived' | 'diligence';
export interface Question { text: string; category: CompanyFactCategory; source: QuestionSource }
export interface Finding { text: string; category: CompanyFactCategory }

// 8 real interview topics, 3 questions each — 'other' is a catch-all
// company-fact bucket, not a real diligence topic, so it's excluded here.
export const TRAIN_CATEGORIES: CompanyFactCategory[] = [
  'product', 'traction', 'team', 'positioning', 'financing', 'regulatory', 'market', 'metrics',
];

export const FIXED_BANK: Question[] = [
  // product
  { text: 'Walk me through what your product actually does, in one sentence a non-technical investor would understand.', category: 'product', source: 'fixed' },
  { text: "What's the hardest technical problem you've had to solve so far, and how did you solve it?", category: 'product', source: 'fixed' },
  { text: 'If you had to cut the product down to one core feature, what would survive and why?', category: 'product', source: 'fixed' },
  // traction
  { text: 'What is the strongest piece of proof you have that people actually want this?', category: 'traction', source: 'fixed' },
  { text: 'Walk me through your most recent customer conversation — what did they actually say?', category: 'traction', source: 'fixed' },
  { text: "What's your retention or repeat-usage number, and why is that the right metric for this stage?", category: 'traction', source: 'fixed' },
  // team
  { text: 'Walk me through why this specific team is the right one to solve this problem.', category: 'team', source: 'fixed' },
  { text: "What's a decision the team disagreed on, and how did you resolve it?", category: 'team', source: 'fixed' },
  { text: "What skill is missing from the team right now, and what's the plan to cover it?", category: 'team', source: 'fixed' },
  // positioning
  { text: 'What stops a larger incumbent from doing this next quarter?', category: 'positioning', source: 'fixed' },
  { text: 'Who is your real competitor — not the one on your slide, the one investors will actually think of?', category: 'positioning', source: 'fixed' },
  { text: 'Why now? What changed in the market that makes this the right time?', category: 'positioning', source: 'fixed' },
  // financing
  { text: 'What are your unit economics, and how did you arrive at those numbers?', category: 'financing', source: 'fixed' },
  { text: 'Why this amount, and what does it specifically get you?', category: 'financing', source: 'fixed' },
  { text: "What happens if you raise half of what you're asking for?", category: 'financing', source: 'fixed' },
  // regulatory
  { text: 'What is your regulatory path, and what could block it — if applicable to your sector?', category: 'regulatory', source: 'fixed' },
  { text: 'Has anything about how you describe the product changed because of a regulatory conversation?', category: 'regulatory', source: 'fixed' },
  { text: "Who owns regulatory risk on your team, and what's their plan for the next 6 months?", category: 'regulatory', source: 'fixed' },
  // market
  { text: 'How big is this market really, and how do you know?', category: 'market', source: 'fixed' },
  { text: "What's your bottom-up math for market size — not the top-down TAM slide number?", category: 'market', source: 'fixed' },
  { text: 'Which adjacent market would you expand into next, and why that one first?', category: 'market', source: 'fixed' },
  // metrics
  { text: 'Which single metric do you check every week, and why that one?', category: 'metrics', source: 'fixed' },
  { text: "What's a metric you used to track that you stopped trusting, and why?", category: 'metrics', source: 'fixed' },
  { text: "What would '10x better' look like for your core metric a year from now?", category: 'metrics', source: 'fixed' },
];

function bankByCategory(bank: Question[]): Map<CompanyFactCategory, Question[]> {
  const m = new Map<CompanyFactCategory, Question[]>();
  for (const q of bank) {
    if (!m.has(q.category)) m.set(q.category, []);
    m.get(q.category)!.push(q);
  }
  return m;
}

// Rotates through all 8 categories (one per pick, so `count` fixed picks are
// always `count` DISTINCT categories as long as count <= 8) and, within a
// category, through its 3 variants — so the same question text can't recur
// inside any realistic 3-session window. `sessionCount` = how many coaching
// sessions have run before this one (0 for the very first).
export function pickFixedQuestions(sessionCount: number, count: number, bank: Question[] = FIXED_BANK): Question[] {
  const byCat = bankByCategory(bank);
  const catCount = TRAIN_CATEGORIES.length;
  const base = sessionCount * count;
  const picks: Question[] = [];
  for (let i = 0; i < count; i++) {
    const category = TRAIN_CATEGORIES[(base + i) % catCount];
    const variants = byCat.get(category) ?? [];
    if (variants.length === 0) continue;
    const variantIdx = Math.floor((base + i) / catCount) % variants.length;
    picks.push(variants[variantIdx]);
  }
  return picks;
}

// Findings (weaknesses/risks, or recommendations, from ai_reviews — never
// investor-side data) turned into questions. Excludes text seen in recent
// sessions (`recentTexts`, built by the caller from real coaching_runs
// history) whenever there are enough alternatives, and prefers categories
// not already covered by `usedCategories` — so a session spans more ground
// than "4 fixed + 4 about the same topic". Still fully deterministic (a
// pure function of its inputs, never Math.random()); unlike the fixed
// bank's 24-question pool, a small finding pool can genuinely run out of
// fresh material — pigeonhole, not a bug — so this falls back to allowing a
// repeat rather than returning fewer than `count` questions.
export function pickFindingQuestions(
  findings: Finding[], usedCategories: Set<CompanyFactCategory>, recentTexts: Set<string>, count: number, source: QuestionSource,
): Question[] {
  if (findings.length === 0) return [];
  const toQuestion = (f: Finding): Question => ({
    text: `An investor pushed back on this: "${f.text}" — how would you answer that, right now?`,
    category: f.category, source,
  });
  // Freshness is checked against the final rendered question text, not the
  // raw finding text — recentTexts (built from real coaching_runs history)
  // only ever contains rendered question text, so comparing anything else
  // against it silently never matches.
  const scored = findings.map((f, i) => {
    const q = toQuestion(f);
    return { q, i, isFresh: !recentTexts.has(q.text), isNewCategory: !usedCategories.has(f.category) };
  });
  scored.sort((a, b) => {
    if (a.isFresh !== b.isFresh) return a.isFresh ? -1 : 1;
    if (a.isNewCategory !== b.isNewCategory) return a.isNewCategory ? -1 : 1;
    return a.i - b.i;
  });
  return scored.slice(0, count).map(({ q }) => q);
}

// Session composition: 4 fixed + 2 derived (weaknesses/risks) + 2 diligence
// (recommendations) = 8, gracefully degrading to 8 fixed when there's
// nothing to draw from yet — Train works from minute 1, it just gets
// richer once a Review has run. weaknessesAndRisks/recommendations both
// come from ai_reviews only, by construction of what the caller passes in
// (never access_grants/interactions) — that boundary is the whole point of
// the 'diligence' source. `recentTexts` = question text used in recent
// coaching_runs, built by the caller from real history.
export function buildSession(
  sessionCount: number, weaknessesAndRisks: Finding[], recommendations: Finding[], recentTexts: Set<string> = new Set(),
): Question[] {
  if (weaknessesAndRisks.length === 0 && recommendations.length === 0) {
    return pickFixedQuestions(sessionCount, 8);
  }
  const fixed = pickFixedQuestions(sessionCount, 4);
  const usedCategories = new Set(fixed.map((q) => q.category));
  const derived = pickFindingQuestions(weaknessesAndRisks, usedCategories, recentTexts, 2, 'derived');
  derived.forEach((q) => usedCategories.add(q.category));
  const diligence = pickFindingQuestions(recommendations, usedCategories, recentTexts, 2, 'diligence');
  const session = [...fixed, ...derived, ...diligence];

  // Not enough findings/recommendations to reach 8 — top up with more fixed
  // questions (still deterministic/session-indexed, just a plain rotating
  // offset over whatever's left, not the full category math above) rather
  // than shipping a short session.
  if (session.length < 8) {
    const usedTexts = new Set(session.map((q) => q.text));
    const remaining = FIXED_BANK.filter((q) => !usedTexts.has(q.text));
    const needed = 8 - session.length;
    const offset = remaining.length ? sessionCount % remaining.length : 0;
    const rotated = [...remaining.slice(offset), ...remaining.slice(0, offset)];
    session.push(...rotated.slice(0, needed));
  }
  return session;
}
