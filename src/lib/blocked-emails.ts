// Prompt 244/245 — pure helpers shared by the blocked-email check
// (blocked-emails-server.ts, used at every account-creation/invite/grant
// entry point) and the Suspicious Accounts backoffice UI. No I/O here on
// purpose — same convention as account-moderation.ts.

// Trim + lowercase only. Provider-specific aliasing (Gmail's `+tag` and
// dots, etc.) is a known, documented gap — matching on that would need a
// per-provider heuristic this function deliberately doesn't attempt.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
