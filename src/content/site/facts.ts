// Prompt 920 — the few facts the public site states in more than one place, each with ONE definition, so a page can never say "500+"
// while another says "700+". Numbers that come from the product itself are NOT here: plan names, prices and the monthly investor
// quotas are read from src/lib/plans.ts and src/lib/pipeline-unlock.ts at render time (the landing's pricing section does the same),
// and site-content.test.ts fails if a page states a number that is neither one of these constants nor one of those.
//
// Nothing here is an invented number. Each value has its source next to it.

/**
 * "More than 500 verified investor profiles across more than 25 European countries" — the sentence /investors already carried before this
 * prompt ("500+ investor profiles … 25+ European countries"). Measured on 16/10/2026: 760 verified, active, non-test profiles in 28
 * countries (710 without public bodies). These are FLOORS, raised only when Nuno says so (copy decision D5, docs/site-copy-920.md).
 */
export const CATALOGUE_FLOOR = 500;
export const COUNTRIES_FLOOR = 25;
export const CATALOGUE_STATEMENT = `more than ${CATALOGUE_FLOOR} verified investor profiles across more than ${COUNTRIES_FLOOR} European countries`;

/** orgs.daily_cap / orgs.weekly_cap defaults (supabase/migrations/0001_init.sql) — a test reads the migration and fails if they drift. */
export const DEFAULT_DAILY_TARGET = 5;
export const DEFAULT_WEEKLY_TARGET = 20;
const NUMBER_WORDS: Record<number, string> = { 5: 'five', 20: 'twenty' };
/** The two targets as the prose writes them ("five a day and twenty a week"); a value with no word falls back to its digits. */
export const DAILY_TARGET_WORDS = NUMBER_WORDS[DEFAULT_DAILY_TARGET] ?? String(DEFAULT_DAILY_TARGET);
export const WEEKLY_TARGET_WORDS = NUMBER_WORDS[DEFAULT_WEEKLY_TARGET] ?? String(DEFAULT_WEEKLY_TARGET);

/** Where the operating company sits — already public in the Terms and the privacy notice (src/lib/controller.ts); a test checks it is still in CONTROLLER_ADDRESS. */
export const OPERATOR_LOCALITY = 'Viana do Castelo';

/** The day the copy of the new pages was last reviewed; the sitemap and the Article schema read it. Change it when the text changes — never `new Date()`. */
export const SITE_CONTENT_UPDATED = '2026-10-16';
