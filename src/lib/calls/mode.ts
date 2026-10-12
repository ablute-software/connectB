// Prompt 905, changed by Prompt 908 — CALLS_MODE is now only an EMERGENCY BRAKE on the whole Calls area:
//   CALLS_MODE=off                  -> the Calls routes answer 404 and nothing appears anywhere (explicitly set)
//   CALLS_MODE unset (or anything else) -> Calls are ON for everyone the role rules allow
//   CALLS_MODE=allowlist            -> (optional restriction) only the emails in CALLS_TEST_EMAILS
//   CALLS_MODE=on                   -> the same as unset, spelled out
// Until Prompt 908 an unset variable meant off, which left a feature that was already in production invisible
// to the people it was built for. The role rules (who may see the tab, who may create and edit) live in
// access.ts and always apply, whatever this says. Read at request time.
export type CallsMode = 'off' | 'allowlist' | 'on';

export function callsMode(env: Record<string, string | undefined> = process.env): CallsMode {
  const v = (env.CALLS_MODE ?? '').trim().toLowerCase();
  return v === 'off' || v === 'allowlist' ? v : 'on';
}

const norm = (s: string) => s.trim().toLowerCase();

export function callsTestEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.CALLS_TEST_EMAILS ?? '').split(',').map(norm).filter(Boolean);
}

/** May this person use the Calls area right now? (The role rules are checked separately.) */
export function callsAllowedFor(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const mode = callsMode(env);
  if (mode === 'off') return false;
  if (mode === 'allowlist') return !!email && callsTestEmails(env).includes(norm(email));
  return true;
}
