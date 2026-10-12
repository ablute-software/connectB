// Prompt 909 — what the list of an organisation's calls offers on each card, and which cards it shows. Pure, so the
// rules (delete only before opening and with nobody applied; archive anything that is not open; archived hidden
// unless asked) are tested without a browser. The server re-checks every one of them.
import { deleteProblem } from './lifecycle';
import type { CallStatus } from './types';

export interface ListCall { status: CallStatus; effectiveStatus: CallStatus; applicationsTotal: number }

export interface CallMenu { duplicate: boolean; archive: boolean; delete: boolean }

/** The "⋯" menu of a card. A person who cannot configure the call gets nothing in it. */
export function callMenu(c: ListCall, canConfigure: boolean): CallMenu {
  if (!canConfigure) return { duplicate: false, archive: false, delete: false };
  return {
    duplicate: true,
    archive: c.status !== 'archived' && c.effectiveStatus !== 'open',
    delete: deleteProblem(c.effectiveStatus, c.applicationsTotal) === null,
  };
}

export const hasMenu = (m: CallMenu) => m.duplicate || m.archive || m.delete;

/** Archived calls leave the list by default; "Show archived" brings them back. */
export function visibleCalls<T extends { effectiveStatus: CallStatus }>(calls: T[], showArchived: boolean): T[] {
  return showArchived ? calls : calls.filter((c) => c.effectiveStatus !== 'archived');
}

export const DELETE_CONFIRM = 'This permanently deletes the call, its phases and its form. The link stops working.';
export const ARCHIVE_CONFIRM = 'Archive this call? It leaves your lists (use “Show archived” to see it) and its applications are kept.';
