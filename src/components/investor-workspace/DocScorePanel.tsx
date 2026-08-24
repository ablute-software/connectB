'use client';
// Prompt 347 §B — Track & Evaluate mode's right column: rate the document
// currently in focus. Same 0-10 scale + "Private to you" framing as
// ScorecardPanel, its own investor-private table (investor_doc_scores,
// migration 0226) — the founder never sees a score, a note, or even the
// fact that a document was rated (root privacy rule).
import { useEffect, useState } from 'react';

export interface DocScore { score: number; note: string | null }

export function DocScorePanel({ orgId, documentId, documentName, initial, onSaved }: {
  orgId: string; documentId: string; documentName: string;
  initial: DocScore | null;
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
    </div>
  );
}
