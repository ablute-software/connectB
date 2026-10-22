// Prompt 918 (Adenda 2, A) — when a call's cover or logo (or an applicant's own file, Adenda 2 C) cannot be served, the log says WHY (which step failed, what Storage answered), not only "unavailable". One structured line per failure,
// searchable in the Vercel logs by `calls_media_unavailable`. Never carries a person's data: the call id, the kind and the storage path (which is made of the call id and a hash).
import type { StreamFailure } from '../document-proxy';
import type { MediaKind } from './media-limits';

export interface MediaFailureContext { where: 'public' | 'editor' | 'applicant'; kind: MediaKind | 'application_file'; callId: string; path: string }

export function mediaFailureLine(ctx: MediaFailureContext, f: StreamFailure): Record<string, unknown> {
  return { event: 'calls_media_unavailable', ...ctx, stage: f.stage, response: f.response, upstreamStatus: f.upstreamStatus ?? null, reason: f.message ?? null };
}

/** The `onFailure` of streamStorageObject for a call's picture. */
export const logMediaFailure = (ctx: MediaFailureContext) => (f: StreamFailure): void => { console.error(JSON.stringify(mediaFailureLine(ctx, f))); };
