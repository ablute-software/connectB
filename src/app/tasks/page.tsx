'use client';
// Tasks — Prompt 94's restructuring. Today merges with the former Outbox
// (now "Warrants") under this new top-level item; Agenda splits back out to
// its own top-level route (see src/app/agenda/page.tsx). Same ?tab= pattern
// the rest of this app already uses for merged pages.
//
// Prompt 216 §C — third tab "Actions required": everything pending for the
// founder in one place, with the count as a badge on the tab itself. The
// badge and the list come from the same useFounderActions() call, so they
// can never disagree (the fix for bug 182's stuck-badge class of problem:
// one source, re-checked via the shared hooks' own refresh events).
import { Suspense } from 'react';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { TodayPanel } from '@/components/today/TodayPanel';
import { WarrantsPanel } from '@/components/queue/WarrantsPanel';
import { ActionsRequiredPanel, useFounderActions } from '@/components/today/ActionsRequiredPanel';

function TasksInner() {
  const [tab, setTab] = useTabParam('today');
  const actions = useFounderActions();
  const tabs = [
    { key: 'today', label: 'Today' },
    { key: 'actions', label: 'Actions required', badge: actions.count || undefined },
    { key: 'warrants', label: 'Warrants' },
  ];
  return (
    <div>
      <Tabs items={tabs} active={tab} onChange={setTab} />
      {tab === 'warrants' ? <WarrantsPanel /> : tab === 'actions' ? <ActionsRequiredPanel actions={actions} /> : <TodayPanel />}
    </div>
  );
}

export default function TasksPage() {
  return <Suspense fallback={null}><TasksInner /></Suspense>;
}
