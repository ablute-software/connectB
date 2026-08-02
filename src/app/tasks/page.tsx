'use client';
// Tasks — Prompt 94's restructuring. Today merges with the former Outbox
// (now "Warrants") under this new top-level item; Agenda splits back out to
// its own top-level route (see src/app/agenda/page.tsx). Same ?tab= pattern
// the rest of this app already uses for merged pages.
import { Suspense } from 'react';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { TodayPanel } from '@/components/today/TodayPanel';
import { WarrantsPanel } from '@/components/queue/WarrantsPanel';

const TABS = [{ key: 'today', label: 'Today' }, { key: 'warrants', label: 'Warrants' }];

function TasksInner() {
  const [tab, setTab] = useTabParam('today');
  return (
    <div>
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === 'warrants' ? <WarrantsPanel /> : <TodayPanel />}
    </div>
  );
}

export default function TasksPage() {
  return <Suspense fallback={null}><TasksInner /></Suspense>;
}
