'use client';
// Prompt 918 (I1) — Setup, in steps. The list of steps sits on the left on a wide screen (it stays in view while the page scrolls); on a tablet held upright it folds into a
// "Steps" button that opens the list above the content; on a phone the button reads "Step 3 of 7: Form". Each step shows its state — ✓ complete · ⚠ something is missing (the
// number) · not started. "Previous" and "Next" close every step. Touch targets are at least 44 px high wherever a finger is the pointer.
import { useEffect, useRef, useState } from 'react';
import { STEPS, neighbourStep, stepIndex, stepLabel, type StepKey, type StepState } from '@/lib/calls/editor-nav';

const ICON_CLASS: Record<StepState['kind'], string> = {
  complete: 'text-emerald-600', attention: 'text-amber-600', not_started: 'text-gray-400', soon: 'text-gray-300',
};

function StepList({ step, states, onPick }: { step: StepKey; states: Record<StepKey, StepState>; onPick: (s: StepKey) => void }) {
  return (
    <ol className="space-y-0.5" data-testid="step-list">
      {STEPS.map((s, i) => {
        const st = states[s.key];
        const current = s.key === step;
        return (
          <li key={s.key}>
            <button type="button" onClick={() => onPick(s.key)} aria-current={current ? 'step' : undefined} data-testid={`step-${s.key}`}
              className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm lg:min-h-[40px] ${current ? 'bg-[#0E7490]/10 font-semibold text-[#0E7490]' : 'text-gray-700 hover:bg-gray-50'}`}>
              <span className="w-4 shrink-0 text-xs text-gray-400">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.label}</span>
                <span className={`block text-[11px] font-normal ${st.kind === 'attention' ? 'text-amber-700' : 'text-gray-500'}`} data-testid={`step-state-${s.key}`}>{st.label}</span>
              </span>
              <span className={`shrink-0 text-base ${ICON_CLASS[st.kind]}`} aria-hidden="true">{st.icon}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function SetupShell({ step, states, onStep, children }: { step: StepKey; states: Record<StepKey, StepState>; onStep: (s: StepKey) => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const prev = neighbourStep(step, -1); const next = neighbourStep(step, 1);
  const pick = (s: StepKey) => { setOpen(false); onStep(s); };

  // The folded list closes on Escape and when something outside it is pressed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown); document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);

  const here = states[step];
  return (
    <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[15rem_minmax(0,1fr)]" data-testid="setup">
      <nav aria-label="Setup steps" className="hidden lg:sticky lg:top-4 lg:block lg:self-start" data-testid="steps-side">
        <StepList step={step} states={states} onPick={pick} />
      </nav>

      <div ref={box} className="relative mb-4 lg:hidden" data-testid="steps-fold">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" data-testid="steps-button"
          className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-left text-sm font-medium text-gray-800 md:w-auto md:min-w-[11rem]">
          <span className="min-w-0 truncate">
            <span className="md:hidden">Step {stepIndex(step) + 1} of {STEPS.length}: {stepLabel(step)}</span>
            <span className="hidden md:inline">Steps</span>
          </span>
          <span className="flex shrink-0 items-center gap-2"><span className={ICON_CLASS[here.kind]} aria-hidden="true">{here.icon}</span><span aria-hidden="true" className="text-gray-400">▾</span></span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-lg md:right-auto md:w-80" data-testid="steps-menu">
            <StepList step={step} states={states} onPick={pick} />
          </div>
        )}
      </div>

      <div className="min-w-0">
        {children}
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-gray-200 pt-4" data-testid="step-nav">
          {prev ? (
            <button type="button" onClick={() => onStep(prev)} data-testid="step-prev"
              className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">← Previous<span className="hidden sm:inline">: {stepLabel(prev)}</span></button>
          ) : <span />}
          {next ? (
            <button type="button" onClick={() => onStep(next)} data-testid="step-next"
              className="min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">Next<span className="hidden sm:inline">: {stepLabel(next)}</span> →</button>
          ) : <span />}
        </div>
      </div>
    </div>
  );
}

/** A tab or a step that is not built yet. */
export function ComingNext({ title, text, testId }: { title: string; text: string; testId: string }) {
  return (
    <section className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center sm:p-10" data-testid={testId}>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{text}</p>
    </section>
  );
}
