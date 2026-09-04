// Prompt 544 Part C — what a delivered row carries, and which wave it lands in.
//
// The delivery was dropping data the catalog already had. Measured on the ten
// firms delivered to Sherlock Deal: nine had a general email, three had a
// submission form, seven had key_people text, and NONE of it reached the
// founder's pipeline row — the mapper copied name/type/hq/website/stage/check/
// sectors/thesis and stopped. So the row said "not contacted" with an empty
// Next action and no way to contact anyone, while the answer sat one join away.
//
// Kept pure and separate from the mapper so the two rules worth arguing about
// — which channel a firm actually has, and which wave a row lands in — are
// testable without a database.

/** The columns copied from catalog_entities into entities at delivery. */
export interface CatalogContactFields {
  email: string | null;
  submission_channel: string | null;
  submission_channel_type: 'form' | 'email' | 'unknown';
  key_people: string | null;
  general_partner_emails: string | null;
  aum: string | null;
  current_funds: string | null;
  latest_fund: string | null;
  last_investment_found: string | null;
}

/**
 * Which channel this firm actually offers, derived rather than assumed.
 *
 * The mapper used to hard-code 'unknown' for every delivered row, which is
 * why the pipeline could not tell a firm with a submission form from one with
 * nothing at all. A form outranks an email: it is the channel the firm chose
 * to publish, and sending to a general inbox when a form exists is the
 * approach most likely to be ignored.
 */
export function deriveSubmissionChannelType(
  submissionChannel: string | null | undefined,
  email: string | null | undefined,
): 'form' | 'email' | 'unknown' {
  if (submissionChannel?.trim()) return 'form';
  if (email?.trim()) return 'email';
  return 'unknown';
}

/**
 * Everything worth copying, from one catalog row.
 *
 * NOTE: `source_url` is in the prompt's list but does NOT exist on
 * catalog_entities — checked against production, it is an `entities`-only
 * column. There is nothing to copy from, so it is absent here rather than
 * silently written as null.
 */
export function catalogContactFields(c: Record<string, unknown>): CatalogContactFields {
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  const email = str(c.email);
  const channel = str(c.submission_channel);
  return {
    email,
    submission_channel: channel,
    submission_channel_type: deriveSubmissionChannelType(channel, email),
    key_people: str(c.key_people),
    general_partner_emails: str(c.general_partner_emails),
    aum: str(c.aum),
    current_funds: str(c.current_funds),
    latest_fund: str(c.latest_fund),
    last_investment_found: str(c.last_investment_found),
  };
}

/** Rows per wave, in delivery-rank order. */
export const WAVE_SIZE = 3;

/**
 * Wave from position in the delivered batch: 1-3 → W1, 4-6 → W2, rest → W3.
 *
 * Every delivered row used to be wave 1, which made the Pipeline's wave
 * filter and Prompt 359's "waves" coach mark describe a distinction that did
 * not exist. Waves are the product's own discipline — approach a few, learn,
 * then approach more — and ranking is what makes them mean something: the
 * best-matched, most contactable firms come first.
 *
 * Capped at 3 rather than continuing to 4, 5, 6: `entities.wave` is read by
 * the Pipeline filter as a small fixed set, and a founder with 40 rows does
 * not need 14 waves, they need "now / next / later".
 */
export function waveForRank(rank: number): 1 | 2 | 3 {
  if (rank < WAVE_SIZE) return 1;
  if (rank < WAVE_SIZE * 2) return 2;
  return 3;
}
