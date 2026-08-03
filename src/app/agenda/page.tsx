'use client';
// Agenda — Prompt 94's restructuring. Split back out from Today into its
// own top-level route (undoing the 27/07 merge that used to redirect here);
// AgendaPanel itself is unchanged (month grid + Today rail + ICS export),
// same component the merged /today page rendered under its "Agenda" tab.
import { AgendaPanel } from '@/components/today/AgendaPanel';
import { PageTour } from '@/components/onboarding/PageTour';
import { PageGuideButton } from '@/components/onboarding/PageGuideButton';

export default function AgendaPage() {
  return (
    <div className="space-y-4">
      <PageTour pageKey="guide_agenda" />
      <div className="flex items-center justify-between gap-1.5">
        <h1 className="text-lg font-bold">Agenda</h1>
        <PageGuideButton pageKey="guide_agenda" />
      </div>
      <AgendaPanel />
    </div>
  );
}
