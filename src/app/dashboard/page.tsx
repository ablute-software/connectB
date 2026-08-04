'use client';
// Dashboard — Prompt 115 Block B split "Review & Optimization" out into its
// own top-level nav tab (/readiness). Dashboard is Overview only again, so
// the tab bar it used to need for a single item is gone too.
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OverviewPanel } from '@/components/dashboard/OverviewPanel';

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

export default function DashboardPage() {
  return (
    <div>
      <Suspense fallback={null}><LegacyReviewTabRedirect /></Suspense>
      <OverviewPanel />
    </div>
  );
}
