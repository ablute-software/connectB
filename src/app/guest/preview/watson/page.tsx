// Prompt 526 Part B — "Ask Watson", the AI second-opinion preview.
//
// WATSON NEVER RUNS FOR A GUEST. The brief is explicit and this page honours it
// structurally, not by policy: there is no input, no form, no route and no
// client code here that could reach an AI endpoint. The conversation below is
// static markup showing the SHAPE of an answer. Nothing on this page can spend
// a token or read a startup's data, because nothing on this page calls anything.
//
// See the pipeline preview's header for why these use placeholder markup rather
// than the real evaluation components.
import type { Metadata } from 'next';
import { GuestPreviewShell } from '@/components/guest/GuestPreviewShell';
import { FrostedOverlay } from '@/components/guest/FrostedOverlay';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Ask Watson — ${BRAND_NAME} for investors`,
  description: 'A private AI second opinion on any deal in your pipeline.',
  robots: { index: false, follow: false },
};

export default function WatsonPreviewPage() {
  return (
    <GuestPreviewShell active="watson" title="Ask Watson"
      subtitle="A private second opinion on any deal — grounded in what the startup actually shared with you.">
      <FrostedOverlay
        source="watson_preview"
        message="Create an investor account to use Watson and get a private AI second opinion on your deals.">
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="ml-auto max-w-md rounded-2xl rounded-br-sm bg-[#E8F4F8] px-4 py-2.5 text-sm text-gray-800">
            What are the three biggest risks in this round?
          </div>
          <div className="max-w-lg rounded-2xl rounded-bl-sm bg-gray-50 px-4 py-2.5 text-sm text-gray-700">
            <p className="font-medium text-gray-900">Three things stand out.</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>Concentration: one customer is most of the revenue.</li>
              <li>The regulatory path is stated but not evidenced.</li>
              <li>Runway ends before the next milestone lands.</li>
            </ul>
            <p className="mt-2 text-xs text-gray-400">Every claim labelled: fact, company claim, estimate or unknown.</p>
          </div>
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-2.5 text-sm text-gray-300">
            Ask a follow-up…
          </div>
        </div>
      </FrostedOverlay>
    </GuestPreviewShell>
  );
}
