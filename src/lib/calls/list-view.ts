// Prompt 909 — what the list of an organisation's calls offers on each card, and which cards it shows. Pure, so the
// rules (delete in any state, with a confirmation and 30 days to restore; archive anything that is not open; archived hidden
// unless asked) are tested without a browser. The server re-checks every one of them.
import { canDeleteCall } from './lifecycle';
import type { CallStatus } from './types';

export interface ListCall { status: CallStatus; effectiveStatus: CallStatus; applicationsTotal: number }

export interface CallMenu { duplicate: boolean; archive: boolean; delete: boolean }

/** The "⋯" menu of a card. A person who cannot configure the call gets nothing in it. */
export function callMenu(c: ListCall, canConfigure: boolean): CallMenu {
  if (!canConfigure) return { duplicate: false, archive: false, delete: false };
  return {
    duplicate: true,
    archive: c.status !== 'archived' && c.effectiveStatus !== 'open',
    delete: canDeleteCall(),
  };
}

export const hasMenu = (m: CallMenu) => m.duplicate || m.archive || m.delete;

/** Archived calls leave the list by default; "Show archived" brings them back. */
export function visibleCalls<T extends { effectiveStatus: CallStatus }>(calls: T[], showArchived: boolean): T[] {
  return showArchived ? calls : calls.filter((c) => c.effectiveStatus !== 'archived');
}

export const ARCHIVE_CONFIRM = 'Archive this call? It leaves your lists (use “Show archived” to see it) and its applications are kept.';
