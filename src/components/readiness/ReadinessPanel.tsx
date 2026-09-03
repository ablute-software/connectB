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
import { FrostedGate } from '@/components/workspace-shell/FrostedGate';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { REVIEW_OPTIMIZATION_PREVIEW_COPY } from '@/lib/plans';
import { ReviewPanel } from './ReviewPanel';
import { BlueprintPanel } from './BlueprintPanel';
import { MarketDataPanel } from './MarketDataPanel';
import { SherlockPrepPanel } from './SherlockPrepPanel';
import { ActionPlanPanel } from './ActionPlanPanel';
import { TrainPanel } from './TrainPanel';
import { HistoryPanel } from './HistoryPanel';

const TABS = [
  { key: 'review', label: 'Review' },
  // Prompt 219 bloco 3 — o motor de narrativa. Fica a seguir a Review por
  // ser a leitura que alimenta tudo o resto; o gating por tier é o bloco 6.
  { key: 'blueprint', label: 'Pitch Blueprint' },
  // Prompt 360 Part A — its own tab, between Blueprint and Action plan.
  { key: 'market_data', label: 'Market data' },
  // Prompt 440 §A — Sherlock Prep, Phase 2. Between Market data and Action
  // plan: a source of company-side inputs (documents, facts, traction,
  // team, roadmap) that feed the SAME evidence pool Market data and the
  // rest of this tab already draw from — not a downstream report like
  // Action plan/Train.
  { key: 'sherlock_prep', label: 'Sherlock Prep' },
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
    // Prompt 170 §C — was max-w-3xl: on a wide screen the SWOT quadrant (2
    // columns) and the Review cards had a lot of unused space to their
    // right. max-w-5xl gives the quadrant room to breathe without each card
    // stretching too wide to read comfortably, and leaves headroom for
    // Prompt 168's clarification balloons without a second widening later.
    <div className="max-w-5xl space-y-4">
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
      {/* Prompt 554 — the block is two or three screens tall, so centring the
          message in it put the only explanation of the frost a screen and a
          half below the fold. FrostedGate makes it stick to the viewport.
          The pill and note markup are passed through unchanged. */}
      <FrostedGate
        locked={locked}
        blurClassName="space-y-4"
        message={(
          <span className="rounded-full border border-cyan-200 bg-white/90 px-4 py-1.5 text-sm font-semibold text-[#0E7490] shadow-sm">
            {REVIEW_OPTIMIZATION_PREVIEW_COPY}
          </span>
        )}
        note={(
          <span className="max-w-xs text-[11px] text-gray-500">
            Your investability reading and AI reviews will live here.
          </span>
        )}
      >
        <div className="space-y-4">
          {activeTab === 'review' && <ReviewPanel />}
          {activeTab === 'blueprint' && <BlueprintPanel />}
          {activeTab === 'market_data' && <MarketDataPanel />}
          {activeTab === 'sherlock_prep' && <SherlockPrepPanel />}
          {activeTab === 'plan' && <ActionPlanPanel />}
          {activeTab === 'train' && <TrainPanel />}
          {activeTab === 'history' && <HistoryPanel />}
        </div>
      </FrostedGate>
    </div>
  );
}

export function ReadinessPanel() {
  return <Suspense fallback={null}><ReadinessInner /></Suspense>;
}
