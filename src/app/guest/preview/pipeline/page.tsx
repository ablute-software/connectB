// Prompt 526 Part B — the "Find your next unicorn" CTA in the approved
// guest-access email lands here.
//
// WHY A STANDALONE ROUTE AND NOT A GUEST MODE INSIDE InvestorWorkspaceShell:
// the real PipelinePanel fetches /api/portal/pipeline on mount and the shell
// itself only renders under `authEnabled && signedIn && hasAccess`
// (portal/page.tsx). Threading a guest mode through both would mean adding
// unauthenticated branches to components that assume a real session in
// several places — for a screen that, by design, must show no data at all.
// So this route borrows the panel's visual vocabulary (header, overview card,
// filter pills, collapsed card rows) and fills it with skeletons: zero
// fetches, no orgId, nothing to leak.
import type { Metadata } from 'next';
import { FrostedContent, FrostedOverlay, SkeletonBar } from '@/components/guest/FrostedOverlay';
import { GuestPreviewShell } from '@/components/guest/GuestPreviewShell';
import { PREVIEW_COPY, previewSignupHref } from '@/lib/guest-previews';

export const metadata: Metadata = { title: 'Pipeline — preview' };

// Mirrors PipelinePanel's own STATUS_FILTERS labels; they are UI vocabulary,
// not data about anyone.
const FILTERS = ['All', 'No decision', 'Interested', 'Passed', 'Archived', 'Watching'];

export default function PipelinePreviewPage() {
  return (
    <GuestPreviewShell active="pipeline">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Pipeline</h1>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        Startups matched to your thesis, released in waves — only the current wave is actionable.
      </p>

      <div className="relative mt-4">
        <FrostedContent className="space-y-4">
          {/* The overview card: same 3-column grid as PipelinePanel's own. */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="grid items-center gap-x-2 gap-y-1.5" style={{ gridTemplateColumns: '7rem 1fr 2.5rem' }}>
              {[92, 64, 41, 23].map((w) => (
                <div key={w} className="contents">
                  <SkeletonBar className="h-3 w-20" />
                  <div className="h-4 rounded bg-[#0E7490]/80" style={{ width: `${w}%` }} />
                  <SkeletonBar className="h-3 w-6 justify-self-end" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f, i) => (
              <span key={f}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  i === 0 ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600'}`}>
                {f}
              </span>
            ))}
          </div>

          <div className="space-y-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-white">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <div className="h-7 w-7 shrink-0 rounded-lg bg-gray-100" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <SkeletonBar className="h-3.5 w-32" />
                    <SkeletonBar className="h-2.5 w-56 max-w-full" />
                  </div>
                  <span className="hidden shrink-0 rounded-full bg-[#E8F4F8] px-2 py-1 text-[11px] font-semibold text-[#0E7490] sm:block">
                    &nbsp;&nbsp;&nbsp;% match
                  </span>
                  <SkeletonBar className="h-5 w-5 shrink-0" />
                </div>
              </div>
            ))}
          </div>
        </FrostedContent>

        <FrostedOverlay
          title={PREVIEW_COPY.pipeline.title}
          message={PREVIEW_COPY.pipeline.message}
          ctaHref={previewSignupHref('pipeline')}
        />
      </div>
    </GuestPreviewShell>
  );
}
