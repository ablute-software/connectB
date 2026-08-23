'use client';
// Dashboard — Prompt 115 Block B split "Review & Optimization" out into its
// own top-level nav tab (/readiness), and Dashboard went Overview-only
// since the tab bar it used to need for a single item was gone too.
// Prompt 314 §A brings tabs back: Overview (default) plus Progress, which
// took over the investability-over-time chart (itself only just moved to a
// Readiness & Train sub-tab by the superseded Prompt 312, before it
// shipped) — Nuno's call is that this chart is the app's core "this helps
// you improve with use" signal and belongs on the Dashboard, not tucked
// into a Readiness sub-tab.
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { OverviewPanel } from '@/components/dashboard/OverviewPanel';
import { ProgressPanel } from '@/components/dashboard/ProgressPanel';
import { useTrackPageView } from '@/lib/use-track-page-view';

// Compatibility redirect for the old ?tab=review-optimization bookmarks and
// any stale links the tour/onboarding copy still carries — sends them to
// the feature's new home instead of landing on a tab that no longer exists.
function LegacyReviewTabRedirect() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    if (sp.get('tab') === 'review-optimization') router.replace('/readiness');
  }, [sp, router]);

  return null;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'progress', label: 'Progress' },
];

function DashboardTabs() {
  const [tab, setTab] = useTabParam('overview');
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'overview';
  return (
    <div className="space-y-4">
      <Tabs items={TABS} active={activeTab} onChange={setTab} />
      {activeTab === 'overview' && <OverviewPanel />}
      {activeTab === 'progress' && <ProgressPanel />}
    </div>
  );
}

export default function DashboardPage() {
  useTrackPageView('/dashboard');
  return (
    <div>
      <Suspense fallback={null}><LegacyReviewTabRedirect /></Suspense>
      <Suspense fallback={null}><DashboardTabs /></Suspense>
    </div>
  );
}
