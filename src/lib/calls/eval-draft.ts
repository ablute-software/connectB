// Prompt 922 (I3) — the evaluator's unsaved changes, as a pure little state: what the autosave still has to send, merged when a save fails or while another is on its way, and applied on top of what the server
// last said so the screen always shows what the person typed. Client-safe (no I/O).
export interface DraftScore { score?: number | null; comment?: string }
export interface Draft { scores?: Record<string, DraftScore>; overallComment?: string; privateNote?: string }
export interface ScoreEntry { score: number | null; comment: string }

export const isEmptyDraft = (d: Draft): boolean => !d.scores || Object.keys(d.scores).length === 0 ? d.overallComment === undefined && d.privateNote === undefined : false;

/** `later` wins over `earlier`, field by field: a score changed twice keeps the last, a comment typed after a score keeps both. */
export function mergeDraft(earlier: Draft, later: Draft): Draft {
  const out: Draft = {};
  const ids = new Set([...Object.keys(earlier.scores ?? {}), ...Object.keys(later.scores ?? {})]);
  if (ids.size) {
    out.scores = {};
    for (const id of ids) out.scores[id] = { ...(earlier.scores?.[id] ?? {}), ...(later.scores?.[id] ?? {}) };
  }
  const oc = later.overallComment ?? earlier.overallComment; if (oc !== undefined) out.overallComment = oc;
  const pn = later.privateNote ?? earlier.privateNote; if (pn !== undefined) out.privateNote = pn;
  return out;
}

/** What the screen shows: the server's scores with the pending changes on top. */
export function withDraft(server: Record<string, ScoreEntry>, draft: Draft): Record<string, ScoreEntry> {
  const out: Record<string, ScoreEntry> = { ...server };
  for (const [id, d] of Object.entries(draft.scores ?? {})) {
    const prev = out[id] ?? { score: null, comment: '' };
    out[id] = { score: d.score === undefined ? prev.score : d.score, comment: d.comment === undefined ? prev.comment : d.comment };
  }
  return out;
}
