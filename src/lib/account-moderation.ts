// Prompt 123 Block C.2 — pure, testable state-machine logic for the
// suspend/undo/delete/quarantine workflow shared by the Backoffice Startups
// and Investors tabs. Schema (account_moderation_actions + a status column
// per target) is PROPOSE ONLY (migration 0121) — this file has zero I/O so
// it's usable/testable the moment it's written, independent of whether the
// migration is applied yet.
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

// Server-side login gate (§C.2: "implementar no fluxo de auth, server-side,
// não só UI") — any status other than 'active' blocks sign-in.
export function isLoginBlocked(status: ModerationStatus): boolean {
  return status !== 'active';
}

// Visibility exclusion (§C.2: suspended/deleted accounts disappear from the
// other side's pipelines/deck/Catalog, and from ecosystem_facts). One
// pure predicate, reused everywhere a query needs to filter accounts out —
// never reimplemented ad hoc per call site.
export function isVisibleToOthers(status: ModerationStatus): boolean {
  return status === 'active';
}
