// Prompt 526 Part B — "Find your next unicorn", the Pipeline preview.
//
// Public and generic on purpose: unlike the Data Room, which is always scoped
// to one grant, these three previews show what the TOOL looks like and are
// identical for every visitor. There is no token, no grant and no org here, so
// there is nothing a visitor could be shown that they shouldn't be.
//
// WHY PLACEHOLDER MARKUP AND NOT THE REAL PipelinePanel. The real panel reads
// the store (useStore), which exists only inside the authenticated providers;
// rendering it on a public route would either crash for want of a provider or
// need a fake session assembled around it. The layout below mirrors the real
// screen's structure — same header, same filter row, same card shape — without
// coupling a public page to session-only code. If these previews ever need to
// track the real UI closely, the presentational parts should be extracted from
// PipelinePanel first, rather than this page reaching into it.
import type { Metadata } from 'next';
import { GuestPreviewShell } from '@/components/guest/GuestPreviewShell';
import { FrostedOverlay } from '@/components/guest/FrostedOverlay';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Pipeline — ${BRAND_NAME} for investors`,
  description: 'A pipeline of startups curated for your investment thesis.',
  robots: { index: false, follow: false },
};

const ROWS = [
  { co: 'BioSense Labs', match: 'Perfect 94%', why: 'Round opening', stage: 'Seed' },
  { co: 'Northline Robotics', match: 'Strong 81%', why: 'New lead investor', stage: 'Series A' },
  { co: 'Vantage Grid', match: 'Good 68%', why: 'Traction milestone', stage: 'Seed' },
  { co: 'Cobalt Health', match: 'Perfect 91%', why: 'Thesis match', stage: 'Pre-seed' },
];

export default function PipelinePreviewPage() {
  return (
    <GuestPreviewShell active="pipeline" title="Pipeline"
      subtitle="Startups matched to your mandate, scored for fit — you work each wave, never a feed.">
      <FrostedOverlay
        source="pipeline_preview"
        message="Sign up to access a pipeline curated for your investment thesis.">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {['All', 'Perfect fit', 'Strong fit', 'New this week'].map((f) => (
              <span key={f} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600">{f}</span>
            ))}
          </div>
          <div className="divide-y divide-gray-100">
            {ROWS.map((r) => (
              <div key={r.co} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">{r.co}</div>
                  <div className="text-xs text-gray-400">{r.stage} · {r.why}</div>
                </div>
                <span className="shrink-0 rounded-full bg-[#E8F4F8] px-2.5 py-1 text-xs font-medium text-[#0E7490]">{r.match}</span>
              </div>
            ))}
          </div>
        </div>
      </FrostedOverlay>
    </GuestPreviewShell>
  );
}
