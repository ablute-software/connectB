// Prompt 909 (Adenda 2) — what the "Import from documents" screen does with what the server tells it, as pure decisions (the component only draws them):
// on opening — resume a reading in progress, offer a proposal that is ready, say why the last one failed; while reading — keep waiting, show the
// proposal, or go back to the upload with the reason. Client-safe.
import type { Proposal } from './proposal';
import { LOST_POLL_MESSAGE } from './client-errors';

export interface ImportState {
  pending: { id: string; proposal: Proposal } | null;
  reading: { id: string; createdAt: string } | null;
  lastFailure: { id: string; message: string | null; code: string | null; at: string } | null;
}

export type OnOpen =
  | { kind: 'reading'; runId: string; since: number }
  | { kind: 'upload'; waiting: { id: string; proposal: Proposal } | null; error: string | null };

/** A reading still in progress wins (the wait resumes); then a proposal that is ready; then the reason of the last failure. */
export function onOpen(s: ImportState, now: number = Date.now()): OnOpen {
  if (s.reading) return { kind: 'reading', runId: s.reading.id, since: Date.parse(s.reading.createdAt) || now };
  if (s.pending) return { kind: 'upload', waiting: s.pending, error: null };
  return { kind: 'upload', waiting: null, error: s.lastFailure?.message ?? null };
}

/** What the call shows next to its Import button: a reading in progress, or a proposal waiting for review (Adenda 2b). */
export type ImportStatus = 'reading' | 'ready' | null;
export const importStatusOf = (s: Pick<ImportState, 'pending' | 'reading'>): ImportStatus => (s.reading ? 'reading' : s.pending ? 'ready' : null);
export const IMPORT_STATUS_LABEL: Record<Exclude<ImportStatus, null>, string> = { reading: 'Reading the documents…', ready: 'Proposal ready to review' };
/** Fired on window whenever the person's import notices may have changed (seen, opened, dismissed), so the badge on the Calls tab refreshes at once. */
export const IMPORT_NOTICES_EVENT = 'calls:import-notices-changed';

/**
 * "Review" (on a notice, on the call's card, on the pill) opens THAT proposal, not the upload form: a run that is proposed goes straight to its review, one still
 * being read resumes the wait, anything else says why there is nothing to review (Adenda 1, Part A).
 */
export type OnOpenRun =
  | { kind: 'review'; id: string; proposal: Proposal }
  | { kind: 'reading'; runId: string; since: number }
  | { kind: 'upload'; error: string };
export function onOpenRun(a: { ok: boolean; status: number; run?: { id: string; status: string; startedAt?: string; proposal?: Proposal; error?: string | null } }, now: number = Date.now()): OnOpenRun {
  if (!a.ok || !a.run) return { kind: 'upload', error: a.status === 404 ? 'That proposal no longer exists.' : 'We could not open that proposal. Please try again.' };
  const r = a.run;
  if (r.status === 'proposed' && r.proposal) return { kind: 'review', id: r.id, proposal: r.proposal };
  if (r.status === 'reading') return { kind: 'reading', runId: r.id, since: (r.startedAt && Date.parse(r.startedAt)) || now };
  if (r.status === 'failed') return { kind: 'upload', error: r.error ?? 'We could not read the documents.' };
  if (r.status === 'applied') return { kind: 'upload', error: 'That proposal was already applied to the call.' };
  if (r.status === 'discarded') return { kind: 'upload', error: 'That proposal was discarded.' };
  return { kind: 'upload', error: 'That proposal is no longer available.' };
}

export interface PollAnswer {
  ok: boolean; status: number;
  run?: { id: string; status: 'reading' | 'proposed' | 'applied' | 'discarded' | 'failed'; proposal?: Proposal; error?: string | null };
}
export type AfterPoll =
  | { kind: 'wait'; misses: number }
  | { kind: 'review'; id: string; proposal: Proposal }
  | { kind: 'upload'; error: string };

/** Consecutive failed polls before the screen stops asking (the reading itself carries on in the background). */
export const POLL_GIVE_UP = 6;

export function afterPoll(a: PollAnswer, misses: number): AfterPoll {
  if (!a.ok || !a.run) {
    if (a.status === 404) return { kind: 'upload', error: 'That reading no longer exists.' };
    return misses + 1 >= POLL_GIVE_UP ? { kind: 'upload', error: LOST_POLL_MESSAGE } : { kind: 'wait', misses: misses + 1 };
  }
  if (a.run.status === 'reading') return { kind: 'wait', misses: 0 };
  if (a.run.status === 'proposed' && a.run.proposal) return { kind: 'review', id: a.run.id, proposal: a.run.proposal };
  if (a.run.status === 'failed') return { kind: 'upload', error: a.run.error ?? 'We could not read the documents.' };
  return { kind: 'upload', error: 'This reading is no longer available.' };
}
