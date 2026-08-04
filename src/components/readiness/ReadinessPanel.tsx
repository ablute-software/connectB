'use client';
// Readiness & Train — Prompt 115 Block B. Promoted out of Dashboard into its
// own top-level nav tab (was the "Review & Optimization" separador inside
// /dashboard). Three sub-tabs, all in English (closes a Prompt 108 naming
// debt: the original two Portuguese sub-tab names never had English
// equivalents):
//   review — AI reviews, investability ranking, Data Room completeness
//   plan   — Block C, aggregated priority-ordered action plan
//   train  — investor Q&A practice
// The companyCanon capability gates whether this whole tab appears in the
// nav at all (src/components/shell.tsx); reviewOptimization is a separate,
// narrower entitlement that gates just the content behind a frost — a
// founder can see the tab exists and what it promises before it's unlocked
// for their plan.
import { Suspense, useEffect, useState } from 'react';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { REVIEW_OPTIMIZATION_PREVIEW_COPY } from '@/lib/plans';
import { ReviewPanel } from './ReviewPanel';
import { ActionPlanPanel } from './ActionPlanPanel';
import { TrainPanel } from './TrainPanel';
import { HistoryPanel } from './HistoryPanel';

const TABS = [
  { key: 'review', label: 'Review' },
  { key: 'plan', label: 'Action plan' },
  { key: 'train', label: 'Train' },
  { key: 'history', label: 'History' },
];

function ReadinessInner() {
  const [tab, setTab] = useTabParam('review');
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setLocked(!me.entitlements?.reviewOptimization))
      .catch(() => setLocked(true));
  }, []);

  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'review';

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-bold">Readiness & Train</h1>
      <p className="text-xs text-gray-400">
        Feeds on your confirmed <b>Company facts</b> (Settings) and pipeline to help improve the company itself —
        every output is a report, never an action.
      </p>

      <Tabs items={TABS} active={activeTab} onChange={setTab} />

      {/* Batch A — premium preview. `locked` is entitlement-driven (Fase 0:
          true for every plan except the platform org), so the frost is
          shown to every customer today; the built tool underneath stays
          intact for when the entitlement lifts per plan. The overlay
          captures pointer events, so no action underneath can fire. */}
      <div className="relative">
        {locked && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/55 px-4 text-center backdrop-blur-[3px]">
            <span className="rounded-full border border-cyan-200 bg-white/90 px-4 py-1.5 text-sm font-semibold text-[#0E7490] shadow-sm">
              {REVIEW_OPTIMIZATION_PREVIEW_COPY}
            </span>
            <span className="max-w-xs text-[11px] text-gray-500">
              Your investability reading and AI reviews will live here.
            </span>
          </div>
        )}
        <div className={locked ? 'pointer-events-none select-none space-y-4 blur-[2px]' : 'space-y-4'} aria-hidden={locked}>
          {activeTab === 'review' && <ReviewPanel />}
          {activeTab === 'plan' && <ActionPlanPanel />}
          {activeTab === 'train' && <TrainPanel />}
          {activeTab === 'history' && <HistoryPanel />}
        </div>
      </div>
    </div>
  );
}

export function ReadinessPanel() {
  return <Suspense fallback={null}><ReadinessInner /></Suspense>;
}
