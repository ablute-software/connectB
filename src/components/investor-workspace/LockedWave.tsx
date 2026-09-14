'use client';
// Extracted out of PipelinePanel.tsx (Prompt 681 §2.3) so the redesigned
// Pipeline list's single collapsed locked-wave band at the end can render
// EXACTLY this component — same content, same disclosure, not a fork —
// rather than a second copy living beside the original.
//
// Prompt 554 — this block is always locked (it IS the lock), and seven
// 56px placeholder rows plus gaps can exceed a short viewport, so the
// explanation and its button stick to the viewport instead of the block's
// middle. rounded-lg (not the gate's default 2xl) preserved.
import { FrostedGate } from '@/components/workspace-shell/FrostedGate';

export function LockedWave({ hiddenCount, onReview }: { hiddenCount: number; onReview: () => void }) {
  return (
    <FrostedGate
      locked
      overlayClassName="rounded-lg backdrop-blur-sm"
      message={<span className="text-2xl">🔒</span>}
      note={(
        <p className="text-sm font-semibold text-gray-700">
          {hiddenCount} more startup{hiddenCount === 1 ? '' : 's'} unlock{hiddenCount === 1 ? 's' : ''} when you&apos;ve treated this wave
        </p>
      )}
      cta={(
        <button onClick={onReview} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0c637b]">
          Review the wave above
        </button>
      )}
    >
      <div className="space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[56px] rounded-lg border border-gray-100 bg-gray-100" />
        ))}
      </div>
    </FrostedGate>
  );
}
