'use client';
// Today — merges the former /today and /agenda routes into separadores.
// The active tab lives in ?tab= (useTabParam), never component state alone.
import { Suspense } from 'react';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { TodayPanel } from '@/components/today/TodayPanel';
import { AgendaPanel } from '@/components/today/AgendaPanel';

const TABS = [{ key: 'today', label: 'Today' }, { key: 'agenda', label: 'Agenda' }];

function TodayInner() {
  const [tab, setTab] = useTabParam('today');
  return (
    <div>
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === 'agenda' ? <AgendaPanel /> : <TodayPanel />}
    </div>
  );
}

export default function TodayPage() {
  return <Suspense fallback={null}><TodayInner /></Suspense>;
}
