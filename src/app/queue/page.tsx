'use client';
// Queue — merges the former /needs-review and /outbox routes into
// separadores. Both are daily work queues (not configuration), which is why
// they got their own top-level nav item instead of moving into Settings.
import { Suspense } from 'react';
import { useStore } from '@/lib/store';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { NeedsReviewPanel } from '@/components/queue/NeedsReviewPanel';
import { OutboxPanel } from '@/components/queue/OutboxPanel';

function QueueInner() {
  const [tab, setTab] = useTabParam('needs-review');
  const { db } = useStore();
  const needsReviewCount = db.interactions.filter((i) => i.needs_review).length;
  const pendingRuns = db.runs.filter((r) => r.status === 'pending_review').length;

  const tabs = [
    { key: 'needs-review', label: 'Needs review', badge: needsReviewCount },
    { key: 'outbox', label: 'Outbox', badge: pendingRuns },
  ];

  return (
    <div>
      <Tabs items={tabs} active={tab} onChange={setTab} />
      {tab === 'outbox' ? <OutboxPanel /> : <NeedsReviewPanel />}
    </div>
  );
}

export default function QueuePage() {
  return <Suspense fallback={null}><QueueInner /></Suspense>;
}
