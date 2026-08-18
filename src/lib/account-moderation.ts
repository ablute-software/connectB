// Prompt 123 Block C.2 — pure, testable state-machine logic for the
// suspend/undo/delete/quarantine workflow shared by the Backoffice Startups
// and Investors tabs. Schema (account_moderation_actions + a status column
// per target) is migration 0121, applied in production. This file has zero
// I/O — testable independent of the database either way. Extended by
// Prompt 244/245 (migration 0180) for the Suspicious Accounts queue's
// time-boxed suspend.
export const QUARANTINE_DAYS = 30;

export type ModerationStatus = 'active' | 'suspended' | 'deleted';
export type ModerationAction = 'suspend' | 'undo' | 'delete';
export type ModerationTargetType = 'org' | 'investor';

export interface ModerationActionRow {
  id: string;
  targetType: ModerationTargetType;
  targetId: string;
  action: ModerationAction;
  justification: string;
  actor: string;
  createdAt: string;
  quarantineUntil: string | null;
}

// A suspension always sets quarantineUntil = suspendedAt + 30 days,
// computed once at suspend time (not re-derived later) so an owner can't
// reset the clock by suspending again mid-quarantine — canSuspend() below
// already refuses a second suspend while one is active.
export function computeQuarantineUntil(suspendedAtIso: string): string {
  const d = new Date(suspendedAtIso);
  d.setUTCDate(d.getUTCDate() + QUARANTINE_DAYS);
  return d.toISOString();
}

export function isQuarantineActive(quarantineUntilIso: string | null, nowIso: string): boolean {
  if (!quarantineUntilIso) return false;
  return new Date(quarantineUntilIso).getTime() > new Date(nowIso).getTime();
}

export function canSuspend(status: ModerationStatus): boolean {
  return status === 'active';
}

export function canUndo(status: ModerationStatus): boolean {
  return status === 'suspended';
}

// Delete is only ever allowed once the 30-day quarantine has fully elapsed
// on an already-suspended account — never straight from 'active' (suspend
// is always the first step, per the doc's own flow), never while the
// quarantine clock is still running.
export function canDelete(status: ModerationStatus, quarantineUntilIso: string | null, nowIso: string): boolean {
  return status === 'suspended' && !isQuarantineActive(quarantineUntilIso, nowIso);
}

// Prompt 244/245 — a SEPARATE clock from quarantineUntil, deliberately. The
// original suspend flow (Startups/Investors tabs) blocks login/visibility
// INDEFINITELY until an explicit "undo" — quarantineUntil only ever gated
// eligibility for delete, never for how long the account stays locked out.
// The Suspicious Accounts queue's "Suspend X hours/days" action needs a
// suspension that expires on its own, without touching that unrelated
// clock — reusing quarantineUntil for this would silently let a short,
// developer-chosen suspension window also shorten the 30-day delete gate.
// null = indefinite (the pre-existing behaviour, still the default for a
// plain "suspend" with no duration given) — isSuspensionActive(null, ...)
// is therefore always true, matching that default.
export function computeSuspendedUntil(suspendedAtIso: string, hours: number): string {
  return new Date(new Date(suspendedAtIso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function isSuspensionActive(suspendedUntilIso: string | null, nowIso: string): boolean {
  if (!suspendedUntilIso) return true;
  return new Date(suspendedUntilIso).getTime() > new Date(nowIso).getTime();
}

// Server-side login gate (§C.2: "implementar no fluxo de auth, server-side,
// não só UI") — 'deleted' always blocks; 'suspended' blocks only while its
// (optional, possibly indefinite) suspendedUntil clock is still running, so
// a time-boxed suspension from the Suspicious Accounts queue expires on its
// own without a developer having to click "undo".
export function isLoginBlocked(status: ModerationStatus, suspendedUntilIso: string | null, nowIso: string): boolean {
  if (status === 'deleted') return true;
  if (status === 'suspended') return isSuspensionActive(suspendedUntilIso, nowIso);
  return false;
}

// Visibility exclusion (§C.2: suspended/deleted accounts disappear from the
// other side's pipelines/deck/Catalog, and from ecosystem_facts). One
// pure predicate, reused everywhere a query needs to filter accounts out —
// never reimplemented ad hoc per call site. Mirrors isLoginBlocked's
// expiry so a lapsed time-boxed suspension restores both together.
export function isVisibleToOthers(status: ModerationStatus, suspendedUntilIso: string | null, nowIso: string): boolean {
  if (status === 'active') return true;
  if (status === 'suspended') return !isSuspensionActive(suspendedUntilIso, nowIso);
  return false;
}
