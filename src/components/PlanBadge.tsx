// Prompt 117 Bloco G — reusable badge for a feature gated to a specific
// plan tier. Display-truth only, same rule as everywhere else in this repo:
// the UI badge and the server enforcement are two separate checks that must
// both exist (see /api/ai-review's server-side 403 for the enforcement half).
import { planName, type PlanTier } from '@/lib/plans';

export function PlanBadge({ tier }: { tier: PlanTier }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-[#0E7490]">
      🔒 {planName(tier)}
    </span>
  );
}
