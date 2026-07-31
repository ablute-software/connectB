'use client';
// welcome — modal 1/3 (onboarding_sherlockdeal_v2.md §3, §6). Portal to
// document.body, same fix/reasoning as HelpSupportWidget.tsx: mounting
// inside a `position:fixed`, no-z-index ancestor traps the modal's own
// stacking context below later-DOM sticky content on some pages.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { onboardingItem } from '@/lib/onboarding/content';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';

export function WelcomeModal() {
  const { eligibleKey, markSeen, setCondition } = useOnboarding();
  const router = useRouter();
  const item = onboardingItem('welcome')!;
  const open = eligibleKey === 'welcome';
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Its own trigger condition is just "the user is signed in" — no other
  // gate — so it fires on first login, gated purely by `seen`.
  useEffect(() => { setCondition('welcome', true); }, [setCondition]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const focusables = card?.querySelectorAll<HTMLElement>('button, a, [tabindex]') ?? [];
    focusables[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab' || !card) return;
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

  function close() {
    markSeen('welcome');
    previouslyFocused.current?.focus();
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    // Prompt 77 Bloco 0 — this backdrop used to carry onClick={close}, so
    // ANY click anywhere on the page while the modal was mounted marked it
    // seen, whether or not the user ever read it. Confirmed live: a real
    // new signup's seen.welcome was written 11.5s after account creation —
    // consistent with a stray click during page settle, not a deliberate
    // dismissal. The backdrop is now inert; close() only fires from the two
    // buttons and Escape, all of which are real acknowledgements.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-welcome-title"
        className="onboarding-modal-enter w-full max-w-[480px] rounded-2xl bg-white p-8 shadow-2xl">
        <h2 id="onboarding-welcome-title" className="mb-2 text-xl font-semibold text-gray-900">{item.title}</h2>
        <p className="text-[15px] leading-[1.55] text-gray-900/80">{item.body}</p>
        <div className="mt-6 flex items-center gap-3">
          <button onClick={() => { close(); router.push('/settings'); }}
            className="rounded-lg bg-[#0E7490] px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-[#0c637b]">
            {item.primaryCta}
          </button>
          <button onClick={close} className="px-1 py-2.5 text-[13.5px] text-gray-500 hover:text-gray-700">
            {item.secondaryCta}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
