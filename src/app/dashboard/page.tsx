'use client';
// Dashboard — merges the former /dashboard and /company (Review &
// Optimization) routes into separadores. Review & Optimization only exists
// as a tab when the companyCanon capability is on (it used to gate the whole
// nav item; now it gates just this one tab). While /api/me hasn't answered
// yet, the tab bar renders as a same-height skeleton — never a flash of the
// tab appearing then disappearing, and never a layout jump.
import { Suspense, useEffect, useState } from 'react';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { OverviewPanel } from '@/components/dashboard/OverviewPanel';
import { ReviewOptimizationPanel } from '@/components/dashboard/ReviewOptimizationPanel';

const BASE_TABS = [{ key: 'overview', label: 'Overview' }];
const REVIEW_TAB = { key: 'review-optimization', label: 'Review & Optimization', tourId: 'dashboard-review-tab' };

function TabsSkeleton() {
  return <div className="mb-4 h-[41px] animate-pulse rounded bg-gray-50" />;
}

function DashboardInner() {
  const [tab, setTab] = useTabParam('overview');
  const [companyCanon, setCompanyCanon] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setCompanyCanon(!!me.capabilities?.companyCanon))
      .catch(() => setCompanyCanon(false));
  }, []);

  if (companyCanon === null) return <TabsSkeleton />;

  const tabs = companyCanon ? [...BASE_TABS, REVIEW_TAB] : BASE_TABS;
  // A stale ?tab=review-optimization (bookmark, or capability just turned
  // off) with the tab unavailable renders Overview instead of a blank pane —
  // it does not rewrite the URL, so the link still resolves once the
  // capability is back on.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'overview';

  return (
    <div>
      <Tabs items={tabs} active={activeTab} onChange={setTab} />
      {activeTab === 'review-optimization' ? <ReviewOptimizationPanel /> : <OverviewPanel />}
    </div>
  );
}

export default function DashboardPage() {
  return <Suspense fallback={null}><DashboardInner /></Suspense>;
}
