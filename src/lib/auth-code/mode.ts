// Prompt 904 Part B — the switch in front of the code-registration routes.
//
// Until the call screen exists (Stage 1) nobody but Nuno's test may be able to create an
// account through these routes, so the default is OFF and OFF means the routes answer 404
// as if they did not exist:
//   AUTH_CODE_MODE=off        (or unset) -> 404 everywhere
//   AUTH_CODE_MODE=allowlist  -> only emails in AUTH_CODE_TEST_EMAILS (comma separated)
//   AUTH_CODE_MODE=on         -> open to anyone (Stage 1 flips this when the call opens)
// Read at request time, not import time, so changing the Vercel variable needs a redeploy
// but no code change.
import { normalizeEmail } from './policy';

export type AuthCodeMode = 'off' | 'allowlist' | 'on';

export function authCodeMode(env: Record<string, string | undefined> = process.env): AuthCodeMode {
  const v = (env.AUTH_CODE_MODE ?? '').trim().toLowerCase();
  return v === 'on' || v === 'allowlist' ? v : 'off';
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
