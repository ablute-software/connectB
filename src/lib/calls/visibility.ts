// Prompt 909 (adjustment for 907) — who sees a call in "Open calls". A call of a TEST organisation (an investor firm or an
// ecosystem organisation flagged `is_test`) must never be advertised to real startups: it appears only to test accounts
// (an org with `is_test`) and to anyone who has its link. The applicant side (Prompt 907) lists with this function, so the
// rule lives in one place and is tested before the list exists.
import type { CallVisibility } from './types';

export interface ListedCall { visibility: CallVisibility; promoterIsTest: boolean }
export interface Viewer { isTestAccount: boolean }

/** May this person see the call in the "Open calls" list? (Whether it is open, and reaching it by its link, are separate rules.) */
export function appearsInOpenCalls(call: ListedCall, viewer: Viewer): boolean {
  if (call.visibility !== 'listed') return false;      // "Closed — reachable only through its link"
  return !call.promoterIsTest || viewer.isTestAccount;  // test organisations are for test accounts
}

/** The link always works for whoever has it: a test call is hidden from the list, not blocked. */
export const reachableByLink = (): boolean => true;
