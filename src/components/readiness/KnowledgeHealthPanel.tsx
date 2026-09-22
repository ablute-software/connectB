'use client';
// Prompt 358 Phase 3.1 — replaces the old "What's missing (N left)" framing,
// which read as an infinite chore list and was the literal UI Nuno abandoned
// mid-session. Three honest blocks instead of one shrinking/growing counter:
// Solid (evidence-linked — the real thing), On your word (presumed true, the
// NORMAL and largest class, no drama attached to it), and Would strengthen
// your dossier (a ranked, capped list — never the whole backlog at once).
//
// This is a supplement to GapInterrogation, not a replacement for it: the
// actual one-question-at-a-time answering flow (ReviewPanel.tsx/
// BlueprintPanel.tsx) is unchanged underneath, just fed a budgeted list and
// given this framing above it.
import { GAP_QUESTION_BUDGET } from '@/lib/company-gaps';
import type { CompanyClaim } from '@/lib/types';
import type { GapView } from './GapInterrogation';

function isSolid(c: CompanyClaim): boolean {
  return c.status === 'accepted' && Array.isArray(c.documentRefs) && c.documentRefs.length > 0;
}

// Prompt 718 Part B — a G1/G6 gap that is BOTH still firing AND already
// answered: never re-asked, shown once as a stated fact. `gap` carries the
// full GapView so "Update answer" can reopen it for a fresh (replacing,
// per Part C) answer.
export interface StandingFact {
  rule: string; message: string; why: string; closesWhen: string | null;
  answer: string | null; answeredAt: string | null; gap: GapView;
}

function formatAnsweredAt(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export function KnowledgeHealthPanel({
  claims, gaps, standing = [], onUpdateAnswer,
}: {
  claims: CompanyClaim[]; gaps: GapView[]; standing?: StandingFact[]; onUpdateAnswer?: (gap: GapView) => void;
}) {
  const accepted = claims.filter((c) => c.status === 'accepted');
  const solid = accepted.filter(isSolid);
  const onYourWord = accepted.filter((c) => !isSolid(c));
  const wouldStrengthen = gaps.slice(0, GAP_QUESTION_BUDGET);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-800">Solid — {solid.length}</p>
          <p className="mt-1 text-[11px] text-emerald-700">Backed by a document in your Vault. This is what investors treat as externally verified.</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-700">On your word — {onYourWord.length}</p>
          <p className="mt-1 text-[11px] text-gray-500">Presumed true, as stated. This is the normal, largest class — nothing wrong with it.</p>
        </div>
        <div className="rounded-lg border border-[#0E7490]/30 bg-[#E8F4F8] p-3">
          <p className="text-xs font-semibold text-[#0E7490]">Would strengthen your dossier — {wouldStrengthen.length}{gaps.length > wouldStrengthen.length ? ` of ${gaps.length}` : ''}</p>
          {wouldStrengthen.length === 0 ? (
            <p className="mt-1 text-[11px] text-[#0E7490]">Nothing ranks high enough to show right now.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {wouldStrengthen.map((g) => (
                <li key={g.key} className="text-[11px] text-[#0E7490]">
                  <span className="font-medium">{g.message}</span> — {g.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {standing.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-700">Standing — {standing.length}</p>
          <p className="mt-1 text-[11px] text-gray-500">
            You already answered these honestly, but the underlying fact still hasn&apos;t happened — not a question we&apos;ll keep re-asking.
          </p>
          <ul className="mt-1.5 space-y-2">
            {standing.map((s) => (
              <li key={s.rule} className="text-[11px] text-gray-600">
                {s.answer && <p>You told us: <span className="italic text-gray-700">&ldquo;{s.answer}&rdquo;</span></p>}
                <p className="mt-0.5">
                  {s.why}{s.closesWhen ? ` It stays open until ${s.closesWhen}.` : ''}
                  {s.answeredAt && <span className="text-gray-400"> ({formatAnsweredAt(s.answeredAt)})</span>}
                </p>
                {onUpdateAnswer && (
                  <button onClick={() => onUpdateAnswer(s.gap)} className="mt-1 text-[11px] font-medium text-[#0E7490] hover:underline">
                    Update answer
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
