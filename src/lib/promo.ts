// Promo Codes & Offers — pure, I/O-free core (mirrors billing.ts/plans.ts:
// deterministic given its inputs, unit-tested, no env reads, no Supabase
// client). The API routes (backoffice CRUD + founder redeem) compose these;
// the redemption-eligibility rule is defined once here so it can't drift
// between "can this code still be redeemed" checks done in different routes.
import type { PlanTier } from './types';

export type PromoKind = 'percent_off' | 'free_trial';

export interface PromoCode {
  id: string;
  code: string;
  label: string | null;
  kind: PromoKind;
  discount_pct: number;
  applicable_plans: PlanTier[];
  redeemable_until: string | null;
  benefit_duration_months: number | null;
  max_redemptions: number | null;
  active: boolean;
  deleted_at: string | null;
  // Prompt 161 — additive, capability-gated (pioneerBadgeAvailable,
  // migration 0167). Absent/undefined pre-migration.
  is_pioneer?: boolean;
  referral_of_org_id?: string | null;
}

// Plans a promo can meaningfully apply to — 'idea' is already free.
export const PROMO_ELIGIBLE_PLANS: PlanTier[] = ['garage', 'motherfunding'];

export type PromoIneligibleReason =
  | 'not_found' | 'deleted' | 'inactive' | 'expired' | 'redemption_limit_reached' | 'already_redeemed';

/**
 * Whether a code can still be newly redeemed right now, independent of any
 * specific org. `redemptionCount` is the count of rows already in
 * promo_redemptions for this code — the caller queries that; this function
 * only applies the rule.
 */
export function promoEligibility(
  promo: Pick<PromoCode, 'active' | 'deleted_at' | 'redeemable_until' | 'max_redemptions'> | null,
  redemptionCount: number,
  now: Date,
): PromoIneligibleReason | null {
  if (!promo) return 'not_found';
  if (promo.deleted_at) return 'deleted';
  if (!promo.active) return 'inactive';
  if (promo.redeemable_until && new Date(promo.redeemable_until) < now) return 'expired';
  if (promo.max_redemptions != null && redemptionCount >= promo.max_redemptions) return 'redemption_limit_reached';
  return null;
}

// benefit_duration_months=null -> the discount never expires once redeemed.
export function computeBenefitEndsAt(redeemedAt: Date, benefitDurationMonths: number | null): Date | null {
  if (benefitDurationMonths == null) return null;
  const end = new Date(redeemedAt);
  end.setMonth(end.getMonth() + benefitDurationMonths);
  return end;
}

// Whether a redemption's benefit is still in effect right now (permanent
// benefits, benefit_ends_at=null, are always still in effect).
export function benefitStillActive(benefitEndsAt: string | null, now: Date): boolean {
  return benefitEndsAt == null || new Date(benefitEndsAt) > now;
}

// Whether a specific redemption is CURRENTLY granting its benefit —
// deliberately narrower than "is the promo code active": Deactivate and
// Delete mean two different things, confirmed by the founder (not the
// original design here, which wrongly conflated them):
//   - Deactivate (`active=false`) only blocks NEW redemptions going
//     forward. Anyone who already redeemed keeps their benefit until it
//     naturally expires — that's the whole point of "deactivate" rather
//     than "delete" existing as a separate, softer action.
//   - Delete (`deleted_at` set) is the one that revokes EVERY current
//     holder's benefit immediately, everywhere — the founder-facing Plans
//     page, the effective plan tier (plan-server.ts), and this promo's own
//     redemptions list. Irreversible, which is why the back-office delete
//     action requires typing DELETE to confirm (see promo-codes/page.tsx).
// So this function checks `deleted_at` only, never `active`.
export function isRedemptionCurrentlyActive(
  promo: Pick<PromoCode, 'deleted_at'> | null,
  benefitEndsAt: string | null,
  now: Date,
): boolean {
  if (!promo || promo.deleted_at) return false;
  return benefitStillActive(benefitEndsAt, now);
}

export function discountedPriceEur(originalEur: number, discountPct: number): number {
  return Math.round(originalEur * (100 - discountPct) / 100);
}

// kind='free_trial' forces the 100% case — enforced here so the backoffice
// create form and the API route agree on the same rule without duplicating it.
export function normalizeDiscountForKind(kind: PromoKind, discountPct: number): number {
  return kind === 'free_trial' ? 100 : discountPct;
}

// A short, human-typeable default if the admin doesn't type their own code —
// uppercase alnum, no ambiguous characters (0/O, 1/I/L) to avoid support
// tickets from a founder misreading a code shown on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generatePromoCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export function normalizePromoCodeInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

// ---------- Prompt 854 §B.5 — the outreach table's own code generator ----------

export type OutreachCategory = 'startup' | 'accelerator' | 'incubator' | 'program';

// The word(s) that merely restate THIS row's own category — dropped so the
// code spends its characters on what the target is CALLED, not on what it
// IS (the category column already says that). THE/A/O/DE/DA/DO are always
// candidates too, regardless of category — English and Portuguese fillers a
// name commonly opens with ("The Beta Fund", "A Fábrica").
const OUTREACH_CATEGORY_WORDS: Record<OutreachCategory, string[]> = {
  startup: ['STARTUP'],
  accelerator: ['ACELERADORA', 'ACCELERATOR'],
  incubator: ['INCUBADORA', 'INCUBATOR'],
  program: ['PROGRAMA', 'PROGRAM'],
};
const OUTREACH_UNIVERSAL_FILLERS = ['THE', 'A', 'O', 'DE', 'DA', 'DO'];

// Unicode's "Combining Diacritical Marks" block — built from numeric code
// points rather than a literal character class so the accent marks
// themselves never have to appear (or risk being mis-transcribed) in this
// source file.
const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

function stripDiacritics(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < COMBINING_MARK_START || code > COMBINING_MARK_END) out += ch;
  }
  return out;
}

function normalizeOutreachWords(name: string): string[] {
  // NFD + strip combining marks is the standard diacritics-stripping idiom
  // (á -> a + ´, then drop the ´) — no extra dependency needed for it.
  const stripped = stripDiacritics(name.normalize('NFD'));
  return stripped.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

/**
 * A working promo code for an outreach target, at most 10 characters,
 * ending in the discount value, built from the target's name and category.
 * Deterministic given `isTaken` (injected, never a live DB call here — the
 * route composes this with a real uniqueness check against promo_codes).
 */
export function buildOutreachPromoCode(
  name: string, category: OutreachCategory, discountPct: number,
  isTaken: (code: string) => boolean,
): string {
  const suffix = String(discountPct);
  const budget = Math.max(1, 10 - suffix.length);
  const stopwords = new Set([...OUTREACH_CATEGORY_WORDS[category], ...OUTREACH_UNIVERSAL_FILLERS]);

  let words = normalizeOutreachWords(name);
  if (words.length === 0) words = ['X']; // a name that is entirely punctuation

  // Drop a LEADING word only, and only when the list wouldn't end up empty —
  // a one-word name that happens to BE a stopword (e.g. a target literally
  // named "Startup") keeps its only word rather than vanishing.
  const dropped: string[] = [];
  if (words.length > 1 && stopwords.has(words[0])) dropped.push(words.shift()!);

  let stem = words.join('').slice(0, budget);
  const floor = Math.min(3, budget);
  if (stem.length < floor) {
    // Pad from whatever was dropped first (still real signal from the
    // name), then the remaining words, so a short stem never comes out
    // cryptic — "A" alone becomes "AAA...", not a bare "A".
    const padSource = (dropped.join('') + words.join('')) || 'X';
    let i = 0;
    while (stem.length < floor) {
      stem += padSource[i % padSource.length];
      i++;
    }
    stem = stem.slice(0, budget);
  }
  if (!stem) stem = 'X'.slice(0, budget);

  const firstCode = (stem + suffix).slice(0, 10);
  if (!isTaken(firstCode)) return firstCode;

  // Collision: replace the stem's LAST character through CODE_ALPHABET; once
  // all 31 are taken for this stem length, shorten the stem by one and start
  // again. Bounded, and never returns a code longer than 10 or already taken.
  let currentStem = stem;
  let attempts = 0;
  const MAX_ATTEMPTS = 200;
  while (currentStem.length > 0 && attempts < MAX_ATTEMPTS) {
    for (const ch of CODE_ALPHABET) {
      const candidate = (currentStem.slice(0, -1) + ch + suffix).slice(0, 10);
      attempts++;
      if (!isTaken(candidate)) return candidate;
      if (attempts >= MAX_ATTEMPTS) break;
    }
    currentStem = currentStem.slice(0, -1);
  }

  // Give up on a readable stem entirely; a fully random one is still ≤10
  // chars, still ends in the discount digits, and still checked for
  // uniqueness before it's returned.
  let fallback = (generatePromoCode(budget) + suffix).slice(0, 10);
  let guard = 0;
  while (isTaken(fallback) && guard < 50) {
    fallback = (generatePromoCode(budget) + suffix).slice(0, 10);
    guard++;
  }
  return fallback;
}
