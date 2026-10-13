// Prompt 904 Part B / Prompt 911 — the switch in front of the code-registration routes.
//
// Since Prompt 911 (13/10/2026) registering with a 6-digit code is the NORMAL way to create an account, for everybody:
//   AUTH_CODE_MODE unset (or anything else) -> on: every registration confirms the email with a code
//   AUTH_CODE_MODE=off                      -> the emergency brake: the routes answer 404 and every page falls back to the
//                                              link-only flow it had before (same rule as CALLS_MODE in Prompt 908)
//   AUTH_CODE_MODE=allowlist                -> kept for tests: only emails in AUTH_CODE_TEST_EMAILS (everyone else gets the
//                                              link-only flow)
// `on` is what a typo gets, on purpose: a value that is not `off` must never silently switch the code flow off, because the
// confirmation email now carries the code and the page has to have somewhere to put it.
// Read at request time, not import time, so changing the Vercel variable needs a redeploy but no code change.
import { normalizeEmail } from './policy';

export type AuthCodeMode = 'off' | 'allowlist' | 'on';

export function authCodeMode(env: Record<string, string | undefined> = process.env): AuthCodeMode {
  const v = (env.AUTH_CODE_MODE ?? '').trim().toLowerCase();
  return v === 'off' || v === 'allowlist' ? v : 'on';
}

export function authCodeTestEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.AUTH_CODE_TEST_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean);
}

/** May this email use the routes right now? Pure; the routes call it before touching anything. */
export function authCodeAllows(email: string, env: Record<string, string | undefined> = process.env): boolean {
  const mode = authCodeMode(env);
  if (mode === 'on') return true;
  if (mode === 'allowlist') return authCodeTestEmails(env).includes(normalizeEmail(email));
  return false;
}
