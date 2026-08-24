'use client';
// Prompt 347 §B — Track & Evaluate mode's right column: rate the document
// currently in focus. Same 0-10 scale + "Private to you" framing as
// ScorecardPanel, its own investor-private table (investor_doc_scores,
// migration 0226) — the founder never sees a score, a note, or even the
// fact that a document was rated (root privacy rule).
//
// Prompt 355 §A — versioned: `initial` is only ever the score matching the
// document's CURRENT version (never a stale one); `needsReRate` and
// `history` surface what happened to any PAST rating when the founder
// uploaded a new version — never deleted, archived with its own date.
import { useEffect, useState } from 'react';

export interface DocScore { score: number; note: string | null }
export interface DocScoreHistoryEntry { score: number; note: string | null; updatedAt: string }

export function DocScorePanel({ orgId, documentId, documentName, initial, needsReRate, history, onSaved }: {
  orgId: string; documentId: string; documentName: string;
  initial: DocScore | null;
  needsReRate?: boolean;
  history?: DocScoreHistoryEntry[];
  // Told about a successful save so the caller's own doc-list badge
  // (Documents tab) updates without a second fetch of its own.
  onSaved: (documentId: string, score: DocScore) => void;
}) {
  const [score, setScore] = useState<number | null>(initial?.score ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the focused document changes — never carries over the
  // previous document's draft onto a new one.
  useEffect(() => {
    setScore(initial?.score ?? null);
    setNote(initial?.note ?? '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function save(n: number) {
    setScore(n); setBusy(true); setError(null);
    try {
      const res = await fetch('/api/portal/doc-scores', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, documentId, score: n, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setError(data.error ?? 'Could not save — try again.'); return; }
      onSaved(documentId, { score: n, note: note.trim() || null });
    } finally { setBusy(false); }
  }

  async function saveNoteOnly() {
    if (score == null) return;
    await save(score);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="truncate text-xs font-semibold text-gray-900" title={documentName}>{documentName}</h2>
      <p className="mt-0.5 text-[11px] text-gray-400">Private to you — never shown to the startup.</p>
      {/* Prompt 355 §A — an honest nudge, never a silent carry-over: the
          founder replaced this document's content since the last rating,
          so `initial` here is null even though history below has entries. */}
      {needsReRate && (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          This document was updated since your rating — re-rate?
        </p>
      )}
      {error && <p className="mt-1.5 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-[#B00000]">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-0.5" role="group" aria-label={`Score for ${documentName}`}>
        {Array.from({ length: 11 }, (_, n) => n).map((n) => (
          <button key={n} disabled={busy} onClick={() => void save(n)} title={String(n)}
            className={`h-5 w-5 rounded text-[10px] font-medium ${
              score === n ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            } disabled:opacity-40`}>
            {n}
          </button>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNoteOnly}
        rows={2} placeholder="Short note (optional)…" className="mt-2 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />

      {history && history.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <h3 className="text-[11px] font-semibold text-gray-500">History</h3>
          <ul className="mt-1 space-y-1">
            {history.map((h, i) => (
              <li key={i} className="text-[11px] text-gray-400">
                ★{h.score}/10 · {new Date(h.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · on a previous version
                {h.note && <span className="block text-gray-400">&ldquo;{h.note}&rdquo;</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
