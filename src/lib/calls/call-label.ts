// Prompt 917 (Adenda 1, Part A) — how a call is told apart when it has no name. Two drafts both called "Untitled call" were indistinguishable in a notice and
// in the list: the one with a proposal waiting could not be found. A call without a name is shown with when it was created ("Untitled call · created 15 Oct,
// 12:29"); a call with a name is shown by its name. Pure and client-safe.
export const UNTITLED_CALL = 'Untitled call';

export const isUnnamedCall = (name: string | null | undefined): boolean => !name || name.trim() === '' || name.trim() === UNTITLED_CALL;

/** "15 Oct, 12:29" in the call's own time zone. */
export function createdText(createdAt: string | null | undefined, timezone = 'Europe/Lisbon'): string {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(new Date(t));
  }
}

/** The name of the call, or — when it has none — "Untitled call · created 15 Oct, 12:29". */
export function callLabel(name: string | null | undefined, createdAt: string | null | undefined, timezone?: string): string {
  if (!isUnnamedCall(name)) return (name as string).trim();
  const when = createdText(createdAt, timezone);
  return when ? `${UNTITLED_CALL} · created ${when}` : UNTITLED_CALL;
}
