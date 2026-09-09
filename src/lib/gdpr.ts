// Prompt 574 §A.1 — GDPR is the one queue with a real legal deadline. Before
// this file, three separate copies of the same arithmetic existed
// (queue-summary.ts, the Attention rollup, and the Queue page's own GdprTab);
// this is the one place it lives.
//
// Prompt 626 §D — TWO CORRECTIONS, and the first is a real defect on a legal
// clock rather than a tidy-up.
//
// 1. THE PERIOD IS ONE CALENDAR MONTH, NOT THIRTY DAYS (Article 12(3)). The
//    two are not interchangeable, and the direction of the error is what
//    matters: for a request made on 1 February the month ends on 1 March —
//    28 days — so a flat 30-day clock reported two days in hand that the law
//    does not give. In 31-day months it erred the safe way, which is exactly
//    why it went unnoticed. Calendar arithmetic now, with the end-of-month
//    clamp the Regulation implies: 31 January + one month is 28/29 February,
//    never 2 or 3 March.
//
// 2. THE EXTENSION EXISTED IN LAW AND NOWHERE IN THE CODE. Article 12(3)
//    allows two further months for complex or numerous requests, and requires
//    the person to be TOLD within the first month, with the reason. So an
//    extension is not "more time", it is a commitment made to somebody — it
//    is RECORDED (gdpr_requests.extended_until / extension_reason) and passed
//    in here, never derived. An extension nobody was told about is not an
//    extension; it is a missed deadline with a longer number beside it.

/** Article 12(3): "without undue delay and in any event within one month". */
export const GDPR_DEADLINE_MONTHS = 1;
/** …"that period may be extended by two further months where necessary". */
export const GDPR_MAX_EXTENSION_MONTHS = 2;

/**
 * One calendar month later, clamped to the end of the target month.
 * 31 Jan → 28 Feb (29 in a leap year), never 2/3 March.
 */
export function addMonthsClamped(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const target = new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth() + months, 1,
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds(),
  ));
  const lastDayOfTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfTarget));
  return target;
}

/** The statutory due date for a request created at `createdAt`. */
export function statutoryDueAt(createdAt: string): Date {
  return addMonthsClamped(new Date(createdAt), GDPR_DEADLINE_MONTHS);
}

/** The latest date an extension may reach: three months from the request. */
export function maxExtensionAt(createdAt: string): Date {
  return addMonthsClamped(new Date(createdAt), GDPR_DEADLINE_MONTHS + GDPR_MAX_EXTENSION_MONTHS);
}

export interface GdprDue {
  daysLeft: number;
  overdue: boolean;
  /** True when the date in force is a recorded extension, not the statutory one. */
  extended: boolean;
  /** The date actually in force, ISO. */
  dueAt: string;
  /** "6 days left" / "OVERDUE by 3" / "6 days left (extended)". */
  label: string;
}

/**
 * @param createdAt      when the request arrived
 * @param now            clock, injectable for tests
 * @param extendedUntil  a RECORDED extension, or null
 */
export function gdprDueAt(createdAt: string, now: number = Date.now(), extendedUntil?: string | null): GdprDue {
  const statutory = statutoryDueAt(createdAt);
  const ceiling = maxExtensionAt(createdAt);

  let due = statutory;
  let extended = false;
  if (extendedUntil) {
    const asked = new Date(extendedUntil);
    if (!Number.isNaN(asked.getTime()) && asked.getTime() > statutory.getTime()) {
      // An extension past three months is not one the law allows, so the clock
      // reports the ceiling rather than the stored value: the queue must show
      // the deadline that binds us, not the one somebody typed.
      due = asked.getTime() > ceiling.getTime() ? ceiling : asked;
      extended = true;
    }
  }

  // Whole days remaining, floored: half a day left is not a day left.
  const daysLeft = Math.floor((due.getTime() - now) / 86400000);
  const overdue = daysLeft < 0;
  return {
    daysLeft,
    overdue,
    extended,
    dueAt: due.toISOString(),
    label: overdue
      ? `OVERDUE by ${-daysLeft}`
      : `${daysLeft} days left${extended ? ' (extended)' : ''}`,
  };
}

/**
 * The four rights the public form offers, in the order Article 15-21 gives
 * them. `rectify` and `erase` are the two that already existed; `access` and
 * `object` were missing, and objection is the one Article 21(2) makes
 * absolute for direct marketing — no reason required, and we stop.
 */
export const GDPR_KINDS = ['access', 'rectify', 'object', 'erase'] as const;
export type GdprKind = (typeof GDPR_KINDS)[number];

export const GDPR_KIND_LABEL: Record<GdprKind, string> = {
  access: 'Send me a copy of what you hold about me',
  rectify: 'Correct something that is wrong',
  object: 'Object — stop holding my information',
  erase: 'Delete my information',
};

export function isGdprKind(v: unknown): v is GdprKind {
  return typeof v === 'string' && (GDPR_KINDS as readonly string[]).includes(v);
}
