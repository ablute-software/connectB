'use client';
// P134-B — the startup dossier ROUTE. The actual content lives in
// StartupDossierContent.tsx (moved out this same prompt, 681 §3): Next's
// App Router only allows a page.tsx to export the well-known route exports
// (default, metadata, generateStaticParams, …) — a named export like
// StartupDossierPageInner fails `next build`'s own typegen check
// (OmitWithTag / checkFields in .next/types), even though plain `tsc
// --noEmit` never catches it. The investor Pipeline's sliding panel
// (PipelinePanel.tsx) imports StartupDossierPageInner from that file
// directly — never from here — so both callers share the exact same
// component with zero forks.
import { Suspense } from 'react';
import { StartupDossierPageInner } from '@/components/portal/StartupDossierContent';

// Prompt 560 §C — the Suspense boundary useSearchParams requires. Next
// asks for it because a page reading the query string cannot be prerendered
// as static HTML; this is the whole cost Prompt 216 §C was avoiding, and it
// is one wrapper against every deep link into this page silently landing on
// the wrong tab.
export default function StartupDossierPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-gray-400">Loading…</p>}>
      <StartupDossierPageInner />
    </Suspense>
  );
}
