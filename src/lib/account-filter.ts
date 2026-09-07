// Prompt 576 Fase 3 — the status filter shared by the Startups and Investors
// Accounts tables. Pure and generic on purpose: both tables already share
// their sort rule (table-sort.ts) for the same reason — write the predicate
// once, never let two tables' "what counts as suspended" quietly diverge.
import type { ModerationStatus } from './account-moderation';

export type AccountFilter = 'all' | 'active' | 'suspended' | 'internal';

export const ACCOUNT_FILTER_LABEL: Record<AccountFilter, string> = {
  all: 'All', active: 'Active', suspended: 'Suspended', internal: 'Internal',
};

export function matchesAccountFilter(
  filter: AccountFilter,
  row: { moderationStatus: ModerationStatus; isInternal: boolean },
): boolean {
  if (filter === 'active') return row.moderationStatus === 'active';
  if (filter === 'suspended') return row.moderationStatus === 'suspended' || row.moderationStatus === 'deleted';
  if (filter === 'internal') return row.isInternal;
  return true;
}
