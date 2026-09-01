// Prompt 526 Part B — the "Ask Watson" CTA in the approved guest-access
// email lands here.
//
// Watson NEVER runs for a guest. That is not enforced by a check on this
// page; it is structural — this route makes no fetch of any kind, so
// /api/portal/watson/* is never reached, and there is no orgId to reach it
// about. The real WatsonEvaluationSupport is always scoped to one startup;
// a guest has none.
import type { Metadata } from 'next';
import { FrostedContent, FrostedOverlay, SkeletonBar } from '@/components/guest/FrostedOverlay';
import { GuestPreviewShell } from '@/components/guest/GuestPreviewShell';
import { PREVIEW_COPY, previewSignupHref } from '@/lib/guest-previews';

export const metadata: Metadata = { title: 'Ask Watson — preview' };

export default function WatsonPreviewPage() {
  return (
    <GuestPreviewShell active="watson">
      <h1 className="text-lg font-bold text-gray-900">Ask Watson</h1>
      <p className="mt-1 text-xs text-gray-400">
        A private AI second opinion on a deal. Yours alone — the startup never sees it unless you choose to share it.
      </p>

      <div className="relative mt-4">
        <FrostedContent className="space-y-4">
          {/* The Watson card, same cyan treatment as the real one. */}
          <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#0E7490]">Watson</span>
              <span className="rounded-lg border border-cyan-300 bg-white px-2.5 py-1 text-xs font-medium text-[#0E7490]">
                Get Watson&apos;s opinion
              </span>
            </div>
          </div>

          {/* Where a reading's insights would render. */}
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
                <SkeletonBar className="h-2.5 w-24" />
                <div className="mt-2 space-y-1.5">
                  <SkeletonBar className="h-2.5 w-full" />
                  <SkeletonBar className="h-2.5 w-11/12" />
                  <SkeletonBar className="h-2.5 w-8/12" />
                </div>
              </div>
            ))}
          </div>
        </FrostedContent>

        <FrostedOverlay
          title={PREVIEW_COPY.watson.title}
          message={PREVIEW_COPY.watson.message}
          ctaHref={previewSignupHref('watson')}
        />
      </div>
    </GuestPreviewShell>
  );
}
