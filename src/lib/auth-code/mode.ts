// Prompt 904 Part B / Prompt 911 — the switch in front of the code-registration routes.
//
// Since Prompt 911 (13/10/2026) registering with a 6-digit code is the NORMAL way to create an account, for everybody:
//   AUTH_CODE_MODE=off   -> the emergency brake: the routes answer 404 and every page falls back to the link-only flow it had
//                           before (same rule as CALLS_MODE in Prompt 908)
//   anything else        -> on: every registration confirms the email with a code
// There is no allowlist any more ("o código passa a valer para todos", Nuno 13/10). The 904 `allowlist` value, which production had
// set, now simply means on: that is deliberate — the flow must not depend on a panel edit to start working, and a value that is not
// `off` (a typo included) must never silently switch the code flow off, because the confirmation email carries the code and the page
// has to have somewhere to put it. AUTH_CODE_TEST_EMAILS is no longer read.
// Read at request time, not import time, so changing the Vercel variable needs a redeploy but no code change.

export type AuthCodeMode = 'off' | 'on';

export function authCodeMode(env: Record<string, string | undefined> = process.env): AuthCodeMode {
  return (env.AUTH_CODE_MODE ?? '').trim().toLowerCase() === 'off' ? 'off' : 'on';
}

/** May the routes be used right now? Pure; the routes call it before touching anything. (The email is no longer a factor.) */
export function authCodeAllows(_email: string, env: Record<string, string | undefined> = process.env): boolean {
  return authCodeMode(env) === 'on';
}
