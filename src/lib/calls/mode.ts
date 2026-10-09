// Prompt 905 — the switch in front of the whole Calls area, same shape as AUTH_CODE_MODE (Prompt 904):
//   CALLS_MODE=off (or unset) -> the Calls routes answer 404 and nothing appears anywhere
//   CALLS_MODE=allowlist      -> only the emails in CALLS_TEST_EMAILS see the tab and may use the routes
//   CALLS_MODE=on             -> everyone who is allowed by the role rules
// Read at request time. The role rules (who may create/edit) are separate and always apply.
export type CallsMode = 'off' | 'allowlist' | 'on';

export function callsMode(env: Record<string, string | undefined> = process.env): CallsMode {
  const v = (env.CALLS_MODE ?? '').trim().toLowerCase();
  return v === 'on' || v === 'allowlist' ? v : 'off';
}

const norm = (s: string) => s.trim().toLowerCase();

export function callsTestEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.CALLS_TEST_EMAILS ?? '').split(',').map(norm).filter(Boolean);
}

/** May this person use the Calls area right now? */
export function callsAllowedFor(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const mode = callsMode(env);
  if (mode === 'on') return true;
  if (mode === 'allowlist') return !!email && callsTestEmails(env).includes(norm(email));
  return false;
}
