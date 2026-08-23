'use client';
// welcome — modal 1/3 (onboarding_sherlockdeal_v2.md §3, §6). Portal to
// document.body, same fix/reasoning as HelpSupportWidget.tsx: mounting
// inside a `position:fixed`, no-z-index ancestor traps the modal's own
// stacking context below later-DOM sticky content on some pages.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onboardingItem } from '@/lib/onboarding/content';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';

export function WelcomeModal() {
  const { eligibleKey, markSeen, setCondition } = useOnboarding();
  const item = onboardingItem('welcome')!;
  const open = eligibleKey === 'welcome';
  const steps = item.steps ?? [];
  const hasSteps = steps.length > 0;
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Its own trigger condition is just "the user is signed in" — no other
  // gate — so it fires on first login, gated purely by `seen`.
  useEffect(() => { setCondition('welcome', true); }, [setCondition]);

  // Prompt 333 — always start a freshly-opened modal on step 1.
  useEffect(() => { if (open) setStep(0); }, [open]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;

    function onKeyDown(e: KeyboardEvent) {
      // Prompt 86 §3/§14 — this is the one popup Escape must NOT close
      // (page tutorials, built later, do close on Escape). Not dismissible
      // by accident, only by one of the buttons.
      if (e.key !== 'Tab' || !card) return;
      // Reads the DOM live on every keypress rather than a list captured
      // once, so it stays correct after Back/Next swaps the step's buttons
      // for a different set (Prompt 333) without a separate recompute step.
      const list = Array.from(card.querySelectorAll<HTMLElement>('button, a, [tabindex]'));
      if (list.length === 0) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Initial focus on open, and again every time the active step changes —
  // `step` is reset to 0 by the effect above whenever `open` flips true, so
  // this alone covers both cases the prompt calls out.
  useEffect(() => {
    if (!open) return;
    const focusables = cardRef.current?.querySelectorAll<HTMLElement>('button, a, [tabindex]') ?? [];
    focusables[0]?.focus();
  }, [open, step]);

  function close() {
    markSeen('welcome');
    previouslyFocused.current?.focus();
  }

  if (!open || typeof document === 'undefined') return null;

  const current = hasSteps ? steps[step] : null;
  const isLastStep = !hasSteps || step === steps.length - 1;
  const title = current?.title ?? item.title;
  const body = current?.body ?? item.body;

  return createPortal(
    // Prompt 77 Bloco 0 — this backdrop used to carry onClick={close}, so
    // ANY click anywhere on the page while the modal was mounted marked it
    // seen, whether or not the user ever read it. Confirmed live: a real
    // new signup's seen.welcome was written 11.5s after account creation —
    // consistent with a stray click during page settle, not a deliberate
    // dismissal. The backdrop is now inert; close() only fires from the
    // buttons, all of which are real acknowledgements.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-welcome-title"
        className="onboarding-modal-enter w-full max-w-[480px] rounded-2xl bg-white p-8 shadow-2xl">
        {hasSteps && (
          <div className="mb-3 flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-[#0E7490]' : 'bg-gray-200'}`} />
            ))}
            <span className="ml-1.5 text-[11px] font-medium text-gray-400">{step + 1} of {steps.length}</span>
          </div>
        )}
        <h2 id="onboarding-welcome-title" className="mb-2 text-xl font-semibold text-gray-900">{title}</h2>
        <p className="text-[15px] leading-[1.55] text-gray-900/80">{body}</p>
        <div className="mt-6 flex items-center gap-3">
          {hasSteps && step > 0 && (
            <button onClick={() => setStep((s) => s - 1)} className="px-1 py-2.5 text-[13.5px] text-gray-500 hover:text-gray-700">
              Back
            </button>
          )}
          {!isLastStep ? (
            <button onClick={() => setStep((s) => s + 1)}
              className="rounded-lg bg-[#0E7490] px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-[#0c637b]">
              Next
            </button>
          ) : (
            <button onClick={close}
              className="rounded-lg bg-[#0E7490] px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-[#0c637b]">
              {hasSteps ? 'Get started' : item.primaryCta}
            </button>
          )}
          {!hasSteps && item.secondaryCta && (
            <button onClick={close} className="px-1 py-2.5 text-[13.5px] text-gray-500 hover:text-gray-700">
              {item.secondaryCta}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
