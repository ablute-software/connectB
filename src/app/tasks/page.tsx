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
//
// Prompt 398 §2 — "Ready to contact" and "Research needed" moved out of
// TodayPanel into their own tabs, same reasoning and same badge/count
// pattern as Actions required: useReadyToContact/useResearchNeeded are the
// single source both the badge here and the panel itself read from.
import { Suspense } from 'react';
import { Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { TodayPanel } from '@/components/today/TodayPanel';
import { WarrantsPanel } from '@/components/queue/WarrantsPanel';
import { ActionsRequiredPanel, useFounderActions } from '@/components/today/ActionsRequiredPanel';
import { ReadyToContactPanel, useReadyToContact } from '@/components/today/ReadyToContactPanel';
import { ResearchNeededPanel, useResearchNeeded } from '@/components/today/ResearchNeededPanel';

function TasksInner() {
  const [tab, setTab] = useTabParam('today');
  const actions = useFounderActions();
  const readyToContact = useReadyToContact();
  const researchNeeded = useResearchNeeded();
  const tabs = [
    { key: 'today', label: 'Today' },
    { key: 'actions', label: 'Actions required', badge: actions.count || undefined },
    { key: 'warrants', label: 'Warrants' },
    // Prompt 398 §2.4 — `tourId` re-anchors guide_today's own
    // 'today-ready'/'today-research' steps onto these tab buttons (always
    // mounted, unlike the panel content behind whichever tab is active) —
    // same fix as 394 §2.4/396 §5.4 for the identical underlying problem.
    { key: 'ready', label: 'Ready to contact', badge: (readyToContact.capReached ? 0 : readyToContact.ready.length) || undefined, tourId: 'today-ready' },
    { key: 'research', label: 'Research needed', badge: researchNeeded.research.length || undefined, tourId: 'today-research' },
  ];
  return (
    <div>
      <Tabs items={tabs} active={tab} onChange={setTab} />
      {tab === 'warrants' ? <WarrantsPanel />
        : tab === 'actions' ? <ActionsRequiredPanel actions={actions} />
        : tab === 'ready' ? <ReadyToContactPanel />
        : tab === 'research' ? <ResearchNeededPanel />
        : <TodayPanel />}
    </div>
  );
}

export default function TasksPage() {
  return <Suspense fallback={null}><TasksInner /></Suspense>;
}
