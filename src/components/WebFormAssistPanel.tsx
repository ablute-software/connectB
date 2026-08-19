'use client';
// Prompt 265 — Web form assistant side panel for /log. Purely controlled:
// every piece of state that needs to survive a collapse/reopen, or that
// "Let Watson Draft" needs to read/fill, lives in LogForm (the parent) —
// this component only owns per-row "just copied ✓" UI flicker, nothing
// that would be lost if it were ever remounted.
//
// Teal accent (existing #0E7490/#E8F4F8 palette, nothing new) so it reads
// as a distinct assistant area, not another plain white Card like its
// neighbors (Watson quota, Pre-flight, Context).
import { useState } from 'react';

export interface FormQuestion { label: string; type?: string }

export function WebFormAssistPanel({
  collapsed, onExpand, onCollapse,
  url, onUrlChange,
  questions, answers, onAnswerChange,
  note, source, extracting,
  onExtract, onRefresh,
  pastedQuestions, onPastedQuestionsChange, onUsePasted,
}: {
  collapsed: boolean; onExpand: () => void; onCollapse: () => void;
  url: string; onUrlChange: (url: string) => void;
  questions: FormQuestion[] | null; answers: string[]; onAnswerChange: (i: number, value: string) => void;
  note: string; source: 'own' | 'community' | 'cached' | 'fresh' | null; extracting: boolean;
  onExtract: () => void; onRefresh: () => void;
  pastedQuestions: string; onPastedQuestionsChange: (v: string) => void; onUsePasted: () => void;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(i);
      setTimeout(() => setCopiedIndex((cur) => cur === i ? null : cur), 1500);
    } catch { /* clipboard permission denied — text is still selectable */ }
  }

  if (collapsed) {
    return (
      <button onClick={onExpand}
        className="w-full rounded-2xl border border-[#0E7490]/30 bg-[#E8F4F8]/40 px-3 py-2 text-left text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8]">
        📝 Web form assistant — reopen
      </button>
    );
  }

  const hasQuestions = !!questions && questions.length > 0;

  return (
    <div className="rounded-2xl border-2 border-[#0E7490] bg-[#E8F4F8]/60 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#0E7490]">📝 Web form assistant</h3>
          <p className="text-xs text-cyan-900/70">We never touch the third-party form itself — you copy each answer over.</p>
        </div>
        <button onClick={onCollapse} title="Close (state is kept for this visit)" className="shrink-0 text-cyan-900/50 hover:text-cyan-900">✕</button>
      </div>

      <label className="mb-2 block text-xs text-cyan-900/80">
        Form link
        <input value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://…/submit-your-pitch"
          className="mt-1 w-full rounded-lg border border-[#0E7490]/30 bg-white px-2 py-1.5 text-sm" />
      </label>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button disabled={extracting} onClick={onExtract}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {extracting ? 'Reading the form…' : hasQuestions ? '↻ Refresh questions' : 'Get form questions'}
        </button>
        {hasQuestions && (
          <button disabled={extracting} onClick={onRefresh}
            className="rounded-lg border border-[#0E7490]/40 bg-white px-2.5 py-1.5 text-xs text-[#0E7490] hover:bg-[#E8F4F8]">
            Re-extract (form changed?)
          </button>
        )}
        {source === 'cached' && <span className="text-[11px] text-cyan-900/60">already extracted before — no AI call spent</span>}
        {source === 'community' && <span className="text-[11px] text-cyan-900/60">found from another startup&apos;s submission</span>}
      </div>

      {note && <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">{note}</p>}

      {hasQuestions ? (
        <div className="space-y-2">
          {questions!.map((q, i) => (
            <div key={i} className="rounded-xl border border-[#0E7490]/20 bg-white p-2.5">
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-gray-700">{q.label}</p>
                <button onClick={() => copy(i, answers[i] ?? '')} disabled={!answers[i]}
                  className="shrink-0 rounded-lg border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                  {copiedIndex === i ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <textarea value={answers[i] ?? ''} onChange={(e) => onAnswerChange(i, e.target.value)} rows={2}
                placeholder="✨ Let Watson Draft, below, fills this in — or type your own."
                className="w-full rounded border border-gray-200 p-1.5 text-sm" />
            </div>
          ))}
        </div>
      ) : (
        <label className="block text-xs text-cyan-900/80">
          Couldn&apos;t auto-read the fields — paste the form&apos;s own questions instead (one per line):
          <textarea value={pastedQuestions} onChange={(e) => onPastedQuestionsChange(e.target.value)} rows={4}
            placeholder={'What problem are you solving?\nHow much are you raising and why?'}
            className="mt-1 w-full rounded-lg border border-[#0E7490]/30 bg-white p-2 text-sm" />
          <button disabled={!pastedQuestions.trim()} onClick={onUsePasted}
            className="mt-1.5 rounded-lg border border-[#0E7490]/40 bg-white px-2.5 py-1 text-xs text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
            Use these questions
          </button>
        </label>
      )}
    </div>
  );
}
