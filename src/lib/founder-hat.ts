// Prompt 900 — when does a membership in a startup org STOP counting as a founder hat?
//
// Two ways an org dies, and both end the hat:
//   closed_at set                      the account ended (the owner closed it, or its last member was removed) — Prompt 556 §D
//   moderation_status = 'deleted'      the platform deleted it (soft: no row is dropped) — Prompt 900, the new case
//
// 'suspended' is deliberately NOT here. A suspension is a sanction on the PERSON as much as on the project (and is
// time-boxed, with a quarantine); the person keeps the hat, and the door (account_access_state(), SQL) keeps blocking
// them for as long as it lasts — whatever else they hold. Only a dead org stops being a hat.
//
// Pure, so the server (resolveRoleSignals) and the middleware (/login redirect — which cannot import server-only code)
// share ONE definition. The SQL side of the same rule is account_has_live_hat() / is_account_suspended() in migration
// 20261013160000_closed_deleted_accounts.sql; this file is not a second copy of the door, only of "is this org a hat".
export interface OrgLiveness {
  closed_at?: string | null;
  moderation_status?: string | null;
}

/**
 * `null`/`undefined` (the row could not be read — RLS, or a column that does not exist yet in an environment where a
 * migration lags) keeps the behaviour from before this prompt: the membership counts as a founder hat. Failing closed here
 * would turn a missing column into "every founder lost their workspace".
 */
export function isLiveFounderOrg(org: OrgLiveness | null | undefined): boolean {
  if (!org) return true;
  return !org.closed_at && org.moderation_status !== 'deleted';
}
