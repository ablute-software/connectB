// Prompt 909 (Adenda 2b) — the in-app notice that tells the person who started an import that the reading has ended, so they do not have to stay on the
// screen: "Proposal ready to review" (with the way back to the review) or "We could not read the documents" (with why). One per run and person.
// The notice has no link path: the entity's Calls area is not a page of its own, so the screen opens the call from the notice (see ImportNotices).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotice } from '../applicant/notices';

export interface ImportNoticeInput { userId: string; callId: string; callName: string; runId: string; outcome: 'ready' | 'failed'; message?: string | null }

export function importNoticeContent(i: Pick<ImportNoticeInput, 'callName' | 'outcome' | 'message'>): { title: string; body: string; ctaLabel: string } {
  const name = i.callName?.trim() || 'your call';
  return i.outcome === 'ready'
    ? { title: 'Proposal ready to review', body: `The documents of “${name}” were read. Review the proposal: nothing is used until you accept it.`, ctaLabel: 'Review the proposal' }
    : { title: 'We could not read the documents', body: `“${name}”: ${i.message ?? 'Please try again.'}`, ctaLabel: 'Try again' };
}

/** Never throws: a notice that could not be written must not undo the proposal it announces. Returns whether one was created. */
export async function notifyImportFinished(admin: SupabaseClient, i: ImportNoticeInput): Promise<boolean> {
  try {
    const { created } = await createNotice(admin, {
      userId: i.userId, callId: i.callId, applicationId: null, kind: i.outcome === 'ready' ? 'import_ready' : 'import_failed',
      dedupeKey: `import:${i.runId}`, content: importNoticeContent(i), linkPath: null,
    });
    return created;
  } catch (e) {
    console.error(`[calls/import-ai] could not write the notice of run ${i.runId}:`, (e as Error).message);
    return false;
  }
}
