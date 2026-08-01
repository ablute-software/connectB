'use client';
// Prompt 86 §7 — the per-page "?" icon. Rearms this page's tour from step 1
// on click. On /settings it replaces the old standalone "Review tips"
// button (that one was scoped to 'welcome' and lived nowhere else — this
// is the one mechanism, same spot, every page).
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';

export function PageGuideButton({ pageKey }: { pageKey: string }) {
  const { rearmKey } = useOnboarding();
  return (
    <button onClick={() => rearmKey(pageKey)} aria-label="Show page guide"
      title="Show page guide"
      className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-[12px] font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700">
      ?
    </button>
  );
}
