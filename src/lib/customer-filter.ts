// Prompt 877 — Ficha do cliente: pure, generic predicates for the customer
// list, same "pure and generic, shared, never duplicated across tables"
// reasoning account-filter.ts already states for the Accounts tables'
// status filter. Kept as a sibling file rather than folded into
// account-filter.ts itself — that file's own filter (active/suspended/
// internal) is about ACCOUNT STATE; this one is about PAYMENT STATE, a
// different axis that applies to a different, wider row shape (orgs AND
// investor firms in one list, not just orgs/investor accounts separately).

export type CustomerFilter = 'all' | 'paid' | 'unpaid' | 'promo';

export const CUSTOMER_FILTER_LABEL: Record<CustomerFilter, string> = {
  all: 'All', paid: 'Paid', unpaid: 'Unpaid', promo: 'Promo',
};

export type PaymentBucket = 'paid' | 'unpaid' | 'promo';

// Nuno's own three-way bucket: a customer currently benefiting from an
// ACTIVE promo redemption is "promo", never double-counted as paid/unpaid
// even if their last real invoice happened to be marked paid — the promo
// state takes precedence because it's the more specific, more actionable
// fact ("they're not paying full price right now").
export function derivePaymentBucket(args: {
  lastPaymentStatus: 'paid' | 'failed' | 'none' | null;
  hasActivePromo: boolean;
}): PaymentBucket {
  if (args.hasActivePromo) return 'promo';
  return args.lastPaymentStatus === 'paid' ? 'paid' : 'unpaid';
}

export function matchesCustomerFilter(filter: CustomerFilter, row: { paymentBucket: PaymentBucket }): boolean {
  if (filter === 'all') return true;
  return row.paymentBucket === filter;
}

// Nuno's one hard behavioral requirement: "sem filtros devem aparecer no
// topo as empresas que estão por pagar, estas devem estar salientadas a
// vermelho." An account is overdue when a payment was actually due and
// didn't come in as paid — `next_payment_due_at` in the past AND the last
// recorded status isn't 'paid'. A customer with no due date at all (never
// billed, e.g. a free-tier org or an investor firm with no investor_billing
// row yet) is never "overdue" — there's nothing they missed.
export function isCustomerOverdue(
  nextPaymentDueAt: string | null,
  lastPaymentStatus: 'paid' | 'failed' | 'none' | null,
  now: Date,
): boolean {
  if (!nextPaymentDueAt) return false;
  return new Date(nextPaymentDueAt) < now && lastPaymentStatus !== 'paid';
}

// Prompt 877 §Arquivo — a customer qualifies for the "Arquivo" sub-tab when
// EITHER their account was cancelled/deleted OR they've been unpaid for
// more than 3 calendar months. Derived fresh every read, never stored —
// same discipline as Prompt 876's isOutreachArchived and Prompt 343's
// derived "Redeemed" column before it.
const ARCHIVE_UNPAID_MONTHS = 3;

export function isCustomerArchived(args: {
  accountDeleted: boolean;
  lastPaymentStatus: 'paid' | 'failed' | 'none' | null;
  /** The most recent signal of "when did billing last matter" — see this
   *  prompt's own reply for which column each subject actually supplies. */
  lastBillingSignalAt: string | null;
  now: Date;
}): boolean {
  if (args.accountDeleted) return true;
  if (args.lastPaymentStatus === 'paid') return false;
  if (!args.lastBillingSignalAt) return false;
  const cutoff = new Date(args.now);
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_UNPAID_MONTHS);
  return new Date(args.lastBillingSignalAt) < cutoff;
}
