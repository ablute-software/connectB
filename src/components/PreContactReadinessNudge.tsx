'use client';
// Prompt 882 Part B — a pre-contact readiness nudge, deliberately NOT built
// on the onboarding engine (src/lib/onboarding/engine.ts, content.ts,
// OnboardingProvider.tsx, onboarding_state table). That engine is "show
// once, dismiss, persist, never again" — right for the welcome modal, wrong
// here: Nuno's own wording is that this dica should keep recurring every
// time the situation applies, until the org has actually used Readiness &
// Train once (org.readiness_train_first_used_at going non-null). So this
// component computes its condition fresh on every render, from live data,
// and persists NOTHING of its own — the same pattern as Pipeline's
// readiness-strip.ts `hasAnythingToShow()` and SherlockInsightBanner's own
// `if (!action) return null`, not the same pattern as the welcome modal.
//
// Visual language borrowed from CoachMark.tsx (the app's "here's a tip"
// bubble) but NOT its dismiss mechanism: "Skip" here is local component
// state only, collapsing the nudge for THIS view — reload brings it back,
// and nothing is ever written to onboarding_state or any other persisted
// flag. The only thing that stops it permanently is the org completing one
// real Review run, Train session, Blueprint read, or Market data pull.
import { useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { relationshipSummary } from '@/lib/relationship';

export function PreContactReadinessNudge({ entityId }: { entityId: string }) {
  const { db } = useStore();
  const [skipped, setSkipped] = useState(false);

  const summary = relationshipSummary(db, entityId);
  const eligible = summary.stage === 'not_contacted' && summary.touchCount === 0 && !db.org.readiness_train_first_used_at;

  if (skipped || !eligible) return null;

  return (
    <div role="note" className="rounded-xl border border-cyan-200 bg-cyan-50/70 p-3 text-left shadow-sm">
      <p className="text-[12.5px] leading-[1.5] text-cyan-900">
        Before reaching out — review your pitch, thesis, and market data. Readiness &amp; Train can check this for
        you.
      </p>
      <div className="mt-1.5 flex items-center gap-3">
        <Link href="/readiness" className="text-[12.5px] font-semibold text-[#0E7490] hover:underline">
          Go to Readiness &amp; Train →
        </Link>
        <button onClick={() => setSkipped(true)} className="text-[12.5px] text-gray-500 hover:underline">
          Skip
        </button>
      </div>
    </div>
  );
}
