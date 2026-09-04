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
 *
 * Prompt 564 §A — it used to return 'form' for ANY non-empty
 * submission_channel, whatever the value contained. Measured across
 * catalog_entities (86 rows with a value): 5 are http(s) URLs, 1 is a
 * `mailto:`, 67 are a bare email address, 6 contain an `@` in some other
 * shape, and 7 are free text naming a form. So 81 of 86 firms were called a
 * "form" and only 5 were one.
 *
 * That single wrong word propagated everywhere it mattered: into the Next
 * Clue ("submit to X through their form"), into the wave-1 first-step task,
 * and into the follow-up suggestion after logging — for firms whose actual
 * channel is an address you CAN write to a second time. Krohnsty's own
 * pipeline had three: Superangel (`mailto:10x AT superangel.io`), Portugal
 * Ventures (`contact@portugalventures.pt`) and Shilling VC
 * (`team@shilling.vc`), all typed `form`.
 *
 * The order of the tests below is the rule: an address anywhere in the value
 * makes it an inbox, because that is the thing you can actually send to
 * twice. Only a URL, or free text with no address in it, is a form. The
 * "form outranks an inbox" precedence survives for a row that genuinely has
 * both — a published form plus a separate general email.
 */
const EMAIL_RE = /[^@\s<>()[\]{},;:"']+@[^@\s<>()[\]{},;:"']+\.[^@\s<>()[\]{},;:"']+/;

export function deriveSubmissionChannelType(
  submissionChannel: string | null | undefined,
  email: string | null | undefined,
): 'form' | 'email' | 'unknown' {
  const channel = submissionChannel?.trim();
  if (channel) {
    // A real, openable form. The only shape that can be rendered as a link.
    if (/^https?:\/\//i.test(channel)) return 'form';
    // `mailto:` is an inbox that happens to be written as a URL scheme.
    if (/^mailto:/i.test(channel)) return 'email';
    // Any address inside the value — bare, or embedded in free text — means
    // there is somewhere to write. Note this deliberately does NOT catch
    // obfuscated forms like "10x AT superangel.io" on its own; that value is
    // caught by the mailto: test above, and an obfuscated address with no
    // scheme falls through to the free-text branch, which is the honest
    // answer: we cannot send to a string we cannot parse.
    if (EMAIL_RE.test(channel)) return 'email';
    // Free text naming a form ("COREangels Porto contact form"). It IS a
    // form; there is simply no URL to open — see submissionFormUrl.
    return 'form';
  }
  if (email?.trim()) return 'email';
  return 'unknown';
}

/**
 * The URL to open for a form, or null when there is nothing to open.
 *
 * Prompt 564 §A — a 'form' row is not necessarily a link. Seven catalog rows
 * name a form in free text with no address at all ("COREangels Porto contact
 * form"), which is a genuine form and a genuine enrichment gap: the founder
 * is told to submit through a form the product cannot open for them. Derived,
 * never stored — `catalog_entities.submission_channel` stays the raw record,
 * and the back-office readiness breakdown can count "form, no URL" from this
 * without a new column.
 */
export function submissionFormUrl(submissionChannel: string | null | undefined): string | null {
  const channel = submissionChannel?.trim();
  if (!channel) return null;
  return /^https?:\/\//i.test(channel) ? channel : null;
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
