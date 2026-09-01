// Prompt 526 Part B — the "Spot the risks others miss" CTA in the approved
// guest-access email lands here.
//
// Mirrors BarsEvaluationSection's layout (the four axis cards, Open questions,
// Risk register). The axis names are framework vocabulary, not data about any
// startup, so they stay legible; every score, band and finding is a skeleton.
// Like the other two previews this route makes no fetch and carries no orgId.
import type { Metadata } from 'next';
import { FrostedContent, FrostedOverlay, SkeletonBar } from '@/components/guest/FrostedOverlay';
import { GuestPreviewShell } from '@/components/guest/GuestPreviewShell';
import { PREVIEW_COPY, previewSignupHref } from '@/lib/guest-previews';

export const metadata: Metadata = { title: 'Spot the risks — preview' };

// Same four axes as BarsEvaluationSection's AXIS_LABEL.
const AXES = ['Team', 'Market', 'Product', 'Technology'];

export default function BarsPreviewPage() {
  return (
    <GuestPreviewShell active="bars">
      <h1 className="text-lg font-bold text-gray-900">Spot the risks</h1>
      <p className="mt-1 text-xs text-gray-400">
        Structured, evidence-anchored assessment across four axes. Private to you, never shown to the startup.
      </p>

      <div className="relative mt-4">
        <FrostedContent className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Evaluation — Sherlock framework</h2>
            <p className="text-[11px] text-gray-400">Relative to the evidence expected at this stage.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {AXES.map((axis) => (
              <div key={axis} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900">{axis}</span>
                  <SkeletonBar className="h-3 w-10" />
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold text-[#0E7490]">—/5</span>
                </div>
                <p className="text-[10px] text-gray-400">relative to expected evidence at this stage</p>
                <div className="mt-1.5 space-y-1">
                  <SkeletonBar className="h-2.5 w-full" />
                  <SkeletonBar className="h-2.5 w-9/12" />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {['Open questions', 'Risk register'].map((title) => (
              <div key={title} className="rounded-lg border border-gray-200 bg-white p-3">
                <span className="text-sm font-semibold text-gray-900">{title}</span>
                <div className="mt-2 space-y-1.5">
                  <SkeletonBar className="h-2.5 w-full" />
                  <SkeletonBar className="h-2.5 w-10/12" />
                  <SkeletonBar className="h-2.5 w-7/12" />
                </div>
              </div>
            ))}
          </div>
        </FrostedContent>

        <FrostedOverlay
          title={PREVIEW_COPY.bars.title}
          message={PREVIEW_COPY.bars.message}
          ctaHref={previewSignupHref('bars')}
        />
      </div>
    </GuestPreviewShell>
  );
}
