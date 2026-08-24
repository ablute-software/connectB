// Prompt 347 §B — "Track & Evaluate" per-document scoring. Investor-private
// (investor_doc_scores, migration 0226) — the founder never sees a score,
// a note, or even the fact that a document was rated at all (root privacy
// rule: existence of a rating IS observation about the founder). No
// founder-facing route imports this file or queries that table.
//
// Prompt 355 §A — versioned: a score now links to the document_versions row
// it was given against (migration 0232). "Current" is whichever score
// matches the document's CURRENT version; every OTHER score for that
// document is history (a rating on since-superseded content, never
// deleted, never silently presented as still-current).
export interface DocScoreRow { document_id: string; document_version_id: string | null; score: number; note: string | null; updated_at: string }
export interface DocScoreHistoryEntry { score: number; note: string | null; updatedAt: string }
export interface DocScoreProjected {
  current: { score: number; note: string | null } | null;
  // True when this document has at least one PAST score but none matching
  // its current version — the founder uploaded a new version since the
  // investor last rated it. Distinct from "never rated at all" (current
  // null AND needsReRate false AND history empty), which isn't a prompt
  // to re-rate, just a document nobody has scored yet.
  needsReRate: boolean;
  history: DocScoreHistoryEntry[];
}

// Pure projection: raw DB rows (one row per version ever scored) plus the
// document's current-version-id map -> the exact per-document shape the
// client receives. Deliberately narrow — investor_member_id/id never leave
// this function, same "narrower export shape, harder to leak by accident"
// discipline as investor-interest-level-db.ts's toInvestorFacingLevelRows.
export function projectDocScoresWithHistory(
  rows: DocScoreRow[], currentVersionByDocument: Record<string, string | null>,
): Record<string, DocScoreProjected> {
  const byDoc = new Map<string, DocScoreRow[]>();
  for (const r of rows) {
    const list = byDoc.get(r.document_id) ?? [];
    list.push(r);
    byDoc.set(r.document_id, list);
  }

  const out: Record<string, DocScoreProjected> = {};
  for (const [docId, docRows] of byDoc) {
    const currentVersionId = currentVersionByDocument[docId] ?? null;
    const currentRow = docRows.find((r) => r.document_version_id === currentVersionId) ?? null;
    const history = docRows
      .filter((r) => r !== currentRow)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((r) => ({ score: r.score, note: r.note, updatedAt: r.updated_at }));
    out[docId] = {
      current: currentRow ? { score: currentRow.score, note: currentRow.note } : null,
      needsReRate: !currentRow && docRows.length > 0,
      history,
    };
  }
  return out;
}
