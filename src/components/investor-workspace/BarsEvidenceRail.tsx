'use client';
// Prompt 412 §B.2 — the evidence rail attached to one question (or one
// red flag): candidates filtered by evidenceHints, offered as attachable
// evidence. CLAUDE.md's root rule holds here by construction —
// bars-evidence.ts's candidate list only ever contains what the investor
// already sees elsewhere in the dossier, never a fresh query of
// founder-private data.
//
// Prompt 438 §B.1 — rewritten to a hard rule with NO exceptions: never an
// inline list of document names, chips or otherwise — not with 80
// candidates, not with 3, not with 0, not on a skipped question. The
// closed state is a single link and nothing else:
//   Evidence · 3 attached · 80 available   ↗
// Everything that used to render here (suggestion chips, manual notes,
// "+ Add note") now lives inside the popup this link opens — see
// EvidenceAccessDialog.tsx. One shared dialog instance per screen, opened
// via onOpenDialog (mounted by the parent — BarsQuestionnaireDrawer —
// never one dialog per rail, same reasoning as Prompt 436's shared
// drawer).
import type { EvidenceCandidate } from '@/lib/bars-evidence';
import { candidatesForHints } from '@/lib/bars-evidence';
import type { EvidenceKind } from '@/lib/bars-types';
import type { BarsEvidenceRef } from '@/lib/bars-scoring';

// Kept as its own type (rather than importing BarsEvidenceRef directly)
// since this is the shape the drawer's own answer/flag rows have always
// carried — structurally identical to BarsEvidenceRef (now including
// locator), so it flows into EvidenceAccessDialog's onChange without
// conversion.
export interface EvidenceRef { kind: EvidenceKind; id?: string; text?: string; locator?: string }

export interface EvidenceDialogRequest {
  title: string;
  candidates: EvidenceCandidate[];
  attached: EvidenceRef[];
  onChange: (refs: BarsEvidenceRef[]) => void;
}

export function BarsEvidenceRail({ title, hints, candidates, loadingCandidates, attached, onChange, onOpenDialog }: {
  title: string; hints: EvidenceKind[]; candidates: EvidenceCandidate[]; loadingCandidates: boolean;
  attached: EvidenceRef[]; onChange: (refs: EvidenceRef[]) => void;
  onOpenDialog: (request: EvidenceDialogRequest) => void;
}) {
  const suggestions = candidatesForHints(candidates, hints);

  return (
    <div className="mt-1.5">
      {loadingCandidates ? (
        <p className="text-[11px] text-gray-400">Loading evidence…</p>
      ) : (
        <button type="button"
          onClick={() => onOpenDialog({ title, candidates: suggestions, attached, onChange })}
          className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:border-gray-300 hover:bg-gray-50">
          Evidence · {attached.length} attached · {suggestions.length} available ↗
        </button>
      )}
    </div>
  );
}
