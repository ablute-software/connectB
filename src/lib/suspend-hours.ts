// Prompt 870 §B — the Suspicious Accounts "Indefinite" preset sends
// hours: null, and the suspend route rejected it with a 400 ("hours must be
// between 1 and 8760"), so choosing Indefinite, writing a justification and
// confirming failed every time. An absent/null hours IS a valid indefinite
// suspension (the plain moderation flow's default); only a present-but-out-of-
// range value is an error. Pulled out as a pure function so the rule is
// unit-tested without standing up the whole authenticated route.

export const MAX_SUSPEND_HOURS = 24 * 365;

export type SuspendHoursCheck =
  | { ok: true; indefinite: boolean }
  | { ok: false; error: string };

export function validateSuspendHours(hours: number | null | undefined): SuspendHoursCheck {
  if (hours == null) return { ok: true, indefinite: true };
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_SUSPEND_HOURS) {
    return { ok: false, error: `hours must be between 1 and ${MAX_SUSPEND_HOURS}, or omitted for an indefinite suspension.` };
  }
  return { ok: true, indefinite: false };
}
