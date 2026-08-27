'use client';
// Prompt 412 §B.2 — the evidence rail attached to one question (or one
// red flag): suggested candidates filtered by evidenceHints, shown as
// attachable chips carrying their tier label ("Document", "Verified
// fact", "Founder-declared", "Your note"), plus a free-text "Add note"
// that becomes an investor_note. CLAUDE.md's root rule holds here by
// construction — bars-evidence.ts's candidate list only ever contains
// what the investor already sees elsewhere in the dossier, never a fresh
// query of founder-private data.
import { useState } from 'react';
import type { EvidenceCandidate } from '@/lib/bars-evidence';
import { candidatesForHints } from '@/lib/bars-evidence';
import type { EvidenceKind } from '@/lib/bars-types';

export interface EvidenceRef { kind: EvidenceKind; id?: string; text?: string }

function sameRef(a: EvidenceRef, b: EvidenceRef): boolean {
  return a.kind === b.kind && (a.id ?? a.text) === (b.id ?? b.text);
}

export function BarsEvidenceRail({ hints, candidates, loadingCandidates, attached, onChange }: {
  hints: EvidenceKind[]; candidates: EvidenceCandidate[]; loadingCandidates: boolean;
  attached: EvidenceRef[]; onChange: (refs: EvidenceRef[]) => void;
}) {
  const [addingNote, setAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const suggestions = candidatesForHints(candidates, hints);

  function toggle(ref: EvidenceRef) {
    const exists = attached.some((a) => sameRef(a, ref));
    onChange(exists ? attached.filter((a) => !sameRef(a, ref)) : [...attached, ref]);
  }

  function submitNote() {
    const text = noteDraft.trim();
    if (!text) return;
    onChange([...attached, { kind: 'investor_note', text }]);
    setNoteDraft('');
    setAddingNote(false);
  }

  const manualNotes = attached.filter((a) => a.kind === 'investor_note' && !suggestions.some((s) => sameRef(s, a)));

  return (
    <div className="mt-1.5">
      {loadingCandidates ? (
        <p className="text-[11px] text-gray-400">Loading evidence…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {suggestions.length === 0 && manualNotes.length === 0 && !addingNote && (
            <span className="text-[11px] text-gray-400">No suggested evidence yet.</span>
          )}
          {suggestions.map((c) => {
            const isOn = attached.some((a) => sameRef(a, { kind: c.kind, id: c.id }));
            return (
              <button key={`${c.kind}:${c.id}`} type="button" onClick={() => toggle({ kind: c.kind, id: c.id, text: c.text })}
                title={c.text}
                className={`max-w-[220px] truncate rounded-full border px-2 py-0.5 text-[11px] ${
                  isOn ? 'border-[#0E7490] bg-[#0E7490]/10 text-[#0E7490]' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                <span className="font-medium">{c.tierLabel}</span> · {c.text}
              </button>
            );
          })}
          {manualNotes.map((n, i) => (
            <span key={`note:${i}`} className="flex items-center gap-1 rounded-full border border-[#0E7490] bg-[#0E7490]/10 px-2 py-0.5 text-[11px] text-[#0E7490]">
              <span className="max-w-[200px] truncate">Your note · {n.text}</span>
              <button type="button" onClick={() => onChange(attached.filter((a) => a !== n))} className="text-[#0E7490]/70 hover:text-[#0E7490]">✕</button>
            </span>
          ))}
          {addingNote ? (
            <span className="flex items-center gap-1">
              <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitNote(); if (e.key === 'Escape') setAddingNote(false); }}
                placeholder="Your note…" className="w-40 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]" />
              <button type="button" onClick={submitNote} className="text-[11px] font-medium text-[#0E7490] hover:underline">Add</button>
              <button type="button" onClick={() => { setAddingNote(false); setNoteDraft(''); }} className="text-[11px] text-gray-400 hover:underline">Cancel</button>
            </span>
          ) : (
            <button type="button" onClick={() => setAddingNote(true)} className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-400 hover:border-gray-400 hover:text-gray-600">
              + Add note
            </button>
          )}
        </div>
      )}
    </div>
  );
}
