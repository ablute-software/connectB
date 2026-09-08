// Prompt 613 §A — the human name of every claim category, and the rule that
// only the human name is ever allowed into a sentence a founder reads.
//
// The bug this exists to end: the Knowledge health card said, on the
// founder's own screen,
//
//   "No paid traction: nothing in tracao_gtm shows money at risk…"
//
// `tracao_gtm` is a ClaimCategory key. It is not a table, not a column, and
// not a word — the founder went looking for it in the product and there was
// nothing to find. The category keys are Portuguese-derived internal ids
// from Prompt 219; the product's surface is English. They were never meant
// to meet.
//
// The keys stay as they are, deliberately: renaming them would rewrite
// company_claims.category across every row and every rule for a cosmetic
// gain. What changes is that nothing interpolates a key into user-facing
// text — it interpolates the label from here, and
// user-facing-vocabulary.test.ts fails the build if a raw key ever reappears
// in a message. That test is the actual fix; this table is what makes it
// cheap to comply with.
import type { ClaimCategory } from './types';

/** How a founder hears the category named, mid-sentence. */
export const CLAIM_CATEGORY_LABEL: Record<ClaimCategory, string> = {
  problema: 'the problem',
  solucao: 'the solution',
  prova_tecnica: 'technical proof',
  validacao_externa: 'external validation',
  tracao_gtm: 'traction and go-to-market',
  equipa: 'the team',
  mercado_timing: 'market and timing',
  funding: 'funding',
  ask: 'the ask',
};

export function claimCategoryLabel(category: ClaimCategory | string): string {
  return CLAIM_CATEGORY_LABEL[category as ClaimCategory] ?? category;
}
