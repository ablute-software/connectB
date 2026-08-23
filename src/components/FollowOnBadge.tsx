// Prompt 319 — follow-on signal badge ("an existing investor would invest
// again"), shown on a startup's investor-facing dossier and on any referral
// card from the same signaling investor. Positive framing on purpose — same
// visual language as PlanBadge.tsx (pill, border, palette color), green
// rather than the alert #B00000 this repo reserves for warnings.
import type { FollowOnPayload } from '@/lib/network';

export function FollowOnBadge({ signal }: { signal: FollowOnPayload }) {
  if (!signal.active) return null;
  const label = signal.visibility === 'named' ? `${signal.investorName} would invest again` : 'An existing investor has signaled interest in a follow-on round';
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
      title="Follow-on interest, declared by the investor.">
      ↻ {label}
    </span>
  );
}
