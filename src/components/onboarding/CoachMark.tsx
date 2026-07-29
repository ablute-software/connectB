'use client';
// Generic just-in-time coach mark (onboarding_sherlockdeal_v2.md §1.2, §6):
// a balloon anchored to its trigger element, no backdrop, dies on the next
// click anywhere, ESC, or its own "Percebi" button. Wraps its anchor
// (`children`) in a relatively-positioned span so the balloon can be
// absolutely positioned against it without any layout library.
import { useEffect } from 'react';
import { onboardingItem } from '@/lib/onboarding/content';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';

export function CoachMark({ itemKey, side = 'bottom', children }: {
  itemKey: string; side?: 'top' | 'bottom'; children: React.ReactNode;
}) {
  const { eligibleKey, markSeen } = useOnboarding();
  const item = onboardingItem(itemKey);
  const open = eligibleKey === itemKey;

  useEffect(() => {
    if (!open) return;
    function dismiss() { markSeen(itemKey); }
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') dismiss(); }
    // Attached a tick late so the same click that revealed this coach mark
    // doesn't immediately close it via bubbling.
    const t = setTimeout(() => {
      document.addEventListener('click', dismiss);
      window.addEventListener('keydown', onKeyDown);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemKey]);

  if (!item) return <>{children}</>;

  return (
    <span className="relative inline-block">
      {children}
      {open && (
        <div role="tooltip" onClick={(e) => e.stopPropagation()}
          className={`onboarding-coachmark-enter absolute left-1/2 z-40 w-[300px] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-xl ${side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'}`}>
          <h4 className="mb-1.5 text-[13.5px] font-semibold text-gray-900">{item.title}</h4>
          <p className="mb-2.5 text-[12.5px] leading-[1.5] text-gray-600">{item.body}</p>
          <button onClick={() => markSeen(itemKey)} className="text-[12.5px] font-semibold text-[#0E7490] hover:underline">
            {item.primaryCta}
          </button>
        </div>
      )}
    </span>
  );
}
