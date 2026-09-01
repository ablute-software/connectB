// Prompt 526 Part B — "Spot the risks others miss", the BARS preview.
//
// Same rules as the other two: public, generic, no grant behind it, and
// placeholder markup rather than the real evaluation section (see the pipeline
// preview's header for why). The dimensions below are the shape of a BARS
// assessment, filled with an illustrative example that names no real company.
import type { Metadata } from 'next';
import { GuestPreviewShell } from '@/components/guest/GuestPreviewShell';
import { FrostedOverlay } from '@/components/guest/FrostedOverlay';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Evaluation tools — ${BRAND_NAME} for investors`,
  description: 'Assess team, market, product and technology with risks surfaced automatically.',
  robots: { index: false, follow: false },
};

const DIMENSIONS = [
  { label: 'Team', score: 4, note: 'Founder-market fit evidenced; one key hire outstanding.' },
  { label: 'Market', score: 3, note: 'Timing supported; sizing rests on a single source.' },
  { label: 'Product', score: 4, note: 'Working product, real usage, thin differentiation claim.' },
  { label: 'Technology', score: 2, note: 'Defensibility asserted, not shown. Contradiction flagged.' },
];

export default function BarsPreviewPage() {
  return (
    <GuestPreviewShell active="bars" title="Evaluation tools"
      subtitle="Team, market, product and technology — scored against anchors, with contradictions surfaced.">
      <FrostedOverlay
        source="bars_preview"
        message="Create an investor account to assess opportunities with BARS.">
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          {DIMENSIONS.map((d) => (
            <div key={d.label} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{d.label}</span>
                <span className="flex gap-0.5" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={`h-1.5 w-6 rounded-full ${n <= d.score ? 'bg-[#0E7490]' : 'bg-gray-200'}`} />
                  ))}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{d.note}</p>
            </div>
          ))}
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            2 contradictions found between the deck and the data room.
          </div>
        </div>
      </FrostedOverlay>
    </GuestPreviewShell>
  );
}
