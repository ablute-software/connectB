'use client';
// Prompt 412 §B.2/§B.3 — the questionnaire drawer for one axis: every
// applicable question as its own block (anchors + evidence rail + skip),
// then the axis's red flags (tri-state + evidence + cap explanation).
// Portal to document.body per CLAUDE.md's root rule on full-viewport
// overlays (position:fixed;inset:0) — copied from HelpSupportWidget.tsx's
// exact pattern (SSR guard, overlay onClick closes, inner panel
// stopPropagation), styled as a right-side drawer instead of a centered
// modal since a full axis questionnaire needs real vertical room.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { getBarsBank } from '@/lib/bars-banks';
import { applicableQuestions } from '@/lib/bars-scoring';
import type { BarsAxis } from '@/lib/bars-types';
import type { CompanyPhase } from '@/lib/types';
import { useEvidenceCandidates } from '@/lib/bars-evidence';
import { BarsEvidenceRail, type EvidenceRef, type EvidenceDialogRequest } from './BarsEvidenceRail';
import { EvidenceAccessDialog } from './EvidenceAccessDialog';

export interface BarsAnswerRow {
  axis: BarsAxis; bank_version: string; question_id: string; level: number | null; skipped: boolean;
  evidence_refs: EvidenceRef[]; note: string | null; updated_at: string;
}
export interface BarsFlagRow {
  flag_id: string; bank_version: string; state: 'unverified' | 'confirmed' | 'cleared';
  evidence_refs: EvidenceRef[]; note: string | null; updated_at: string;
}

const FLAG_STATES = ['unverified', 'confirmed', 'cleared'] as const;
const FLAG_STATE_LABEL: Record<typeof FLAG_STATES[number], string> = { unverified: 'Unverified', confirmed: 'Confirmed', cleared: 'Cleared' };
const FLAG_STATE_COLOR: Record<typeof FLAG_STATES[number], string> = {
  unverified: 'bg-gray-200 text-gray-700', confirmed: 'bg-red-100 text-[#B00000]', cleared: 'bg-emerald-100 text-emerald-700',
};
const RED_FLAG_EVIDENCE_HINTS = ['document', 'claim', 'interaction', 'investor_note'] as const;

function QuestionBlock({ orgId, axis, question, answer, candidates, loadingCandidates, onMutated, onOpenEvidenceDialog }: {
  orgId: string; axis: BarsAxis;
  question: ReturnType<typeof getBarsBank>['questions'][number];
  answer: BarsAnswerRow | undefined;
  candidates: ReturnType<typeof useEvidenceCandidates>['candidates'];
  loadingCandidates: boolean;
  onMutated: () => void;
  onOpenEvidenceDialog: (request: EvidenceDialogRequest) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save(patch: { level?: number | null; skipped?: boolean; evidenceRefs?: EvidenceRef[] }) {
    setSaving(true);
    try {
      const level = patch.level !== undefined ? patch.level : (answer?.level ?? null);
      const skipped = patch.skipped !== undefined ? patch.skipped : (answer?.skipped ?? false);
      const evidenceRefs = patch.evidenceRefs !== undefined ? patch.evidenceRefs : (answer?.evidence_refs ?? []);
      const res = await fetch('/api/portal/bars', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, kind: 'answer', axis, questionId: question.id, level, skipped, evidenceRefs }),
      });
      if (res.ok) setSavedAt(Date.now());
      onMutated();
    } finally { setSaving(false); }
  }

  const options: { value: number; text: string; key: string }[] = [
    { value: 1, text: question.anchors.l1, key: '1' },
    { value: 2, text: 'Between —', key: '2' },
    { value: 3, text: question.anchors.l3, key: '3' },
    { value: 4, text: 'Between —', key: '4' },
    { value: 5, text: question.anchors.l5, key: '5' },
    ...(question.anchors.l5b ? [{ value: 5, text: question.anchors.l5b, key: '5b' }] : []),
  ];
  const isSkipped = answer?.skipped ?? false;
  const selectedLevel = !isSkipped ? (answer?.level ?? null) : null;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">{question.question}</p>
        <span className="shrink-0 text-[10px] text-gray-400">
          {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved ✓' : isSkipped ? 'Skipped' : selectedLevel != null ? `${selectedLevel}/5` : ''}
        </span>
      </div>
      {question.stageNotes && <p className="mt-0.5 text-[11px] text-gray-400">{question.stageNotes}</p>}

      <div className="mt-2 space-y-1">
        {options.map((opt) => {
          const isThisOptionSelected = !isSkipped && selectedLevel === opt.value;
          return (
            <button key={opt.key} onClick={() => void save({ level: opt.value, skipped: false })}
              className={`block w-full rounded border px-2 py-1 text-left text-xs ${
                isThisOptionSelected ? 'border-[#0E7490] bg-[#0E7490]/10 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              <span className="mr-1.5 font-mono text-[10px] text-gray-400">{opt.key}</span>{opt.text}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button onClick={() => void save({ skipped: true, level: null })}
          className={`text-[11px] ${isSkipped ? 'font-medium text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}>
          {isSkipped ? '✓ Not enough evidence to answer' : 'Not enough evidence to answer'}
        </button>
      </div>

      <BarsEvidenceRail title={question.question} hints={question.evidenceHints} candidates={candidates} loadingCandidates={loadingCandidates}
        attached={answer?.evidence_refs ?? []} onChange={(refs) => void save({ evidenceRefs: refs })}
        onOpenDialog={onOpenEvidenceDialog} />
    </div>
  );
}

export function BarsQuestionnaireDrawer({ orgId, axis, axisLabel, companyPhase, answers, flagStates, onClose, onMutated }: {
  orgId: string; axis: BarsAxis; axisLabel: string; companyPhase: CompanyPhase | null;
  answers: BarsAnswerRow[]; flagStates: BarsFlagRow[]; onClose: () => void; onMutated: () => void;
}) {
  const bank = getBarsBank(axis);
  const questions = applicableQuestions(bank, companyPhase ?? 'concept_idea');
  const answersByQuestionId = new Map(answers.filter((a) => a.axis === axis).map((a) => [a.question_id, a]));
  const flagStatesByFlagId = new Map(flagStates.filter((f) => bank.redFlags.some((rf) => rf.id === f.flag_id)).map((f) => [f.flag_id, f]));
  const { candidates, loading: loadingCandidates } = useEvidenceCandidates(orgId, true);
  const [savingFlag, setSavingFlag] = useState<string | null>(null);
  // Prompt 438 §C — ONE shared EvidenceAccessDialog instance for the whole
  // drawer (every question + every red flag), never one per rail — same
  // reasoning as this file's own shared-drawer pattern (436 §B). onChange
  // is wrapped at render time below so every attach/detach/locator edit
  // both persists (via the captured save/saveFlag closure) AND updates
  // this snapshot immediately — without that, the popup would keep
  // showing stale `attached` until the next full reloadBars() round trip.
  const [evidenceDialog, setEvidenceDialog] = useState<EvidenceDialogRequest | null>(null);

  async function saveFlag(flagId: string, state: typeof FLAG_STATES[number], evidenceRefs?: EvidenceRef[]) {
    setSavingFlag(flagId);
    try {
      const current = flagStatesByFlagId.get(flagId);
      const res = await fetch('/api/portal/bars', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, kind: 'flag', axis, flagId, state, evidenceRefs: evidenceRefs ?? current?.evidence_refs ?? [] }),
      });
      if (res.ok) onMutated();
    } finally { setSavingFlag(null); }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 -mx-4 -mt-4 mb-3 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">{axisLabel} — Sherlock framework</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="space-y-2">
          {questions.map((q) => (
            <QuestionBlock key={q.id} orgId={orgId} axis={axis} question={q} answer={answersByQuestionId.get(q.id)}
              candidates={candidates} loadingCandidates={loadingCandidates} onMutated={onMutated}
              onOpenEvidenceDialog={setEvidenceDialog} />
          ))}
        </div>

        {bank.redFlags.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <h3 className="text-xs font-semibold text-gray-500">Red flags</h3>
            <div className="mt-2 space-y-2">
              {bank.redFlags.map((flag) => {
                const state = flagStatesByFlagId.get(flag.id)?.state ?? 'unverified';
                return (
                  <div key={flag.id} className="rounded-lg border border-gray-200 p-2.5">
                    <p className="text-xs text-gray-700">{flag.check}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {FLAG_STATES.map((s) => (
                        <button key={s} onClick={() => void saveFlag(flag.id, s)} disabled={savingFlag === flag.id}
                          className={`rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-40 ${state === s ? FLAG_STATE_COLOR[s] : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                          {FLAG_STATE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                    {state === 'unverified' && (
                      <p className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        UNVERIFIED — material, not yet established
                      </p>
                    )}
                    {state === 'confirmed' && (
                      <p className="mt-1 text-[11px] font-medium text-[#B00000]">Confirmed caps this axis at {flag.capLevel}/5</p>
                    )}
                    <BarsEvidenceRail title={flag.check} hints={[...RED_FLAG_EVIDENCE_HINTS]} candidates={candidates} loadingCandidates={loadingCandidates}
                      attached={flagStatesByFlagId.get(flag.id)?.evidence_refs ?? []}
                      onChange={(refs) => void saveFlag(flag.id, state, refs)}
                      onOpenDialog={setEvidenceDialog} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {evidenceDialog && (
        <EvidenceAccessDialog orgId={orgId} title={evidenceDialog.title} candidates={evidenceDialog.candidates}
          attached={evidenceDialog.attached}
          onChange={(refs) => {
            evidenceDialog.onChange(refs);
            setEvidenceDialog((prev) => (prev ? { ...prev, attached: refs } : prev));
          }}
          onClose={() => setEvidenceDialog(null)} />
      )}
    </div>,
    document.body,
  );
}
