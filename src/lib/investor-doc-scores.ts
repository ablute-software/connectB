// Prompt 347 §B — "Track & Evaluate" per-document scoring. Investor-private
// (investor_doc_scores, migration 0226) — the founder never sees a score,
// a note, or even the fact that a document was rated at all (root privacy
// rule: existence of a rating IS observation about the founder). No
// founder-facing route imports this file or queries that table.
export interface DocScoreRow { document_id: string; score: number; note: string | null }
export interface DocScoreProjected { score: number; note: string | null }

// Pure projection: raw DB rows -> the exact shape the client receives,
// keyed by documentId. Deliberately narrow — investor_member_id/id/
// timestamps never leave this function, the same "narrower export shape,
// harder to leak by accident" discipline as
// investor-interest-level-db.ts's toInvestorFacingLevelRows.
export function projectDocScores(rows: DocScoreRow[]): Record<string, DocScoreProjected> {
  const out: Record<string, DocScoreProjected> = {};
  for (const r of rows) out[r.document_id] = { score: r.score, note: r.note };
  return out;
}
