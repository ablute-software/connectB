'use client';
// Prompt 852 §B — the founder's own "no", in the pipeline row.
//
// Three states in one small component, because they are one decision seen at
// three moments: the ACTION ("Not a fit for us", offered on a row with no
// live decision), the inline FORM (optional category + a required note,
// ≤220 with a live counter), and the RECORD (the label plus an ⓘ that opens
// the saved note with Edit and Revert — the choice is reversible, because
// things change).
//
// Everything it writes goes through the store's three actions, which on the
// real backend call /api/company/investor-decisions — where the
// `investor_decisions` capability is enforced. This component hides the
// controls for a member who lacks it, but the hiding is a courtesy: the route
// is the gate. Demo mode keeps the same three actions local, so
// `npm run dev:verify` exercises the real flow (CLAUDE.md rule 1).
//
// The label is always "Not a fit for us", never "Not a fit" — the latter is
// taken by the PLATFORM's hard filter (hard_filter_status =
// 'resolved_not_a_fit', migration 0195), which is a different thing decided
// by different evidence.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { PASS_REASON_CATEGORIES } from '@/lib/relationship';
import {
  DECISION_NOTE_MAX, NOT_A_FIT_LABEL, noteProblem, noteProblemMessage,
  type StartupInvestorDecision,
} from '@/lib/startup-investor-decision';
import type { PassReasonCategory } from '@/lib/types';

const CATEGORY_LABEL: Record<PassReasonCategory, string> = {
  valuation: 'Valuation', check_size: 'Check size', geography: 'Geography',
  stage_too_early: 'Stage too early', thesis_mismatch: 'Thesis mismatch',
  team: 'Team', traction: 'Traction', other: 'Other',
};

export function categoryLabel(c: string | null | undefined): string | null {
  return c ? (CATEGORY_LABEL[c as PassReasonCategory] ?? c) : null;
}

export function NotAFitAction({ entityId, decision, canDecide }: {
  entityId: string;
  /** The live decision for this entity, when there is one. */
  decision?: StartupInvestorDecision;
  canDecide: boolean;
}) {
  const { recordInvestorDecision, updateInvestorDecision, revertInvestorDecision } = useStore();
  const [mode, setMode] = useState<'idle' | 'form' | 'note'>('idle');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (mode === 'form') {
      setNote(decision?.note ?? '');
      setCategory(decision?.reason_category ?? '');
      setErr('');
    }
  }, [mode, decision]);

  async function run(action: () => Promise<{ error?: string }>) {
    setBusy(true); setErr('');
    try {
      const { error } = await action();
      if (error) { setErr(error); return; }
      setMode('idle');
    } finally { setBusy(false); }
  }

  function save() {
    // The same validator the route runs — a note the browser accepted can
    // never be the one Postgres rejects.
    const problem = noteProblem(note);
    if (problem) { setErr(noteProblemMessage(problem) ?? 'Check the note.'); return; }
    void run(() => decision
      ? updateInvestorDecision({ decisionId: decision.id, note, reasonCategory: category || null })
      : recordInvestorDecision({ entityId, note, reasonCategory: category || null }));
  }

  const remaining = DECISION_NOTE_MAX - note.trim().length;

  if (mode === 'form') {
    return (
      <div className="mt-1 rounded-lg border border-gray-200 bg-white p-2 text-[11px]" onClick={(e) => e.stopPropagation()}>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="mb-1 w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
          <option value="">Reason (optional)</option>
          {PASS_REASON_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoComplete="off"
          placeholder="Why are they not a fit for you? (required)"
          className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
        <div className="mt-1 flex items-center gap-1.5">
          <span className={`text-[10px] ${remaining < 0 ? 'font-semibold text-[#B00000]' : 'text-gray-400'}`}>{remaining}</span>
          <button disabled={busy} onClick={save}
            className="ml-auto rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40">Save</button>
          <button disabled={busy} onClick={() => setMode('idle')}
            className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Cancel</button>
        </div>
        {err && <p className="mt-1 text-[10px] text-[#B00000]">{err}</p>}
      </div>
    );
  }

  if (decision) {
    return (
      <>
        <span ref={anchorRef} className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
          ✕ {NOT_A_FIT_LABEL}
          <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMode(mode === 'note' ? 'idle' : 'note'); }}
            title="Your note" className="text-gray-400 hover:text-gray-700">ⓘ</button>
        </span>
        {mode === 'note' && (
          <DecisionNotePopover anchor={anchorRef.current} onClose={() => setMode('idle')}>
            {categoryLabel(decision.reason_category) && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{categoryLabel(decision.reason_category)}</p>
            )}
            <p className="whitespace-pre-wrap text-[12px] leading-snug text-gray-700">{decision.note}</p>
            <p className="mt-1.5 text-[10px] text-gray-400">
              Recorded {decision.decided_at.slice(0, 10)}
              {decision.updated_at.slice(0, 10) !== decision.decided_at.slice(0, 10) && ` · edited ${decision.updated_at.slice(0, 10)}`}
            </p>
            {canDecide && (
              <div className="mt-2 flex items-center gap-1.5">
                <button disabled={busy} onClick={() => setMode('form')}
                  className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Edit</button>
                <button disabled={busy} onClick={() => void run(() => revertInvestorDecision(decision.id))}
                  title="Put this investor back in the active pipeline. Nothing written is deleted."
                  className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Revert</button>
              </div>
            )}
            {err && <p className="mt-1 text-[10px] text-[#B00000]">{err}</p>}
          </DecisionNotePopover>
        )}
      </>
    );
  }

  if (!canDecide) return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMode('form'); }}
      title="Record that this investor is not a fit for you. Reversible."
      className="ml-1.5 text-[10px] text-gray-300 hover:text-gray-600">✕ {NOT_A_FIT_LABEL}</button>
  );
}

// CLAUDE.md's overlay rule: a full-viewport fixed layer must go through
// createPortal(document.body), never inline in the tree — an ancestor with
// transform/filter/backdrop-filter silently becomes the containing block and
// collapses it, with no error and no failing test. The pipeline table sits
// under the shared WorkspaceHeader, which has exactly such a backdrop-blur.
function DecisionNotePopover({ anchor, onClose, children }: {
  anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode;
}) {
  if (typeof document === 'undefined') return null;
  const rect = anchor?.getBoundingClientRect();
  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute w-64 rounded-lg border border-gray-200 bg-white p-2.5 shadow-xl"
        style={{
          top: Math.min((rect?.bottom ?? 0) + 6, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200),
          left: Math.min(rect?.left ?? 0, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 272),
        }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
