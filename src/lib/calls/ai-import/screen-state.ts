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
