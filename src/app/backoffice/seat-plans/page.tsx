'use client';
// Prompt 904 Part C (C3, C6) and Adenda 1 (v2) — back-office: seats of custom plans, in four sub-tabs whose
// state lives in the URL (?tab=…, plus ?firm=… for the firm that is picked / open) so a refresh keeps its place:
//   create   Create plan                  pick a firm, give it N seats, hold/add people, codes
//   plans    Firms with a custom plan     list + search + sort; click a firm to manage it right there; End plan
//   history  History                      every firm's seat events, with filters
//   ended    Ended plans                  the archive: each ended plan and who held a seat when it ended
// Never touch the real Portugal Ventures profile from tests: use a zz-test-… catalog entry.
import { Suspense, useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/ui';
import { CreateTab } from '@/components/backoffice/seat-plans/CreateTab';
import { PlansTab } from '@/components/backoffice/seat-plans/PlansTab';
import { HistoryTab } from '@/components/backoffice/seat-plans/HistoryTab';
import { EndedTab } from '@/components/backoffice/seat-plans/EndedTab';
import { SEAT_TABS, SEAT_TAB_LABELS, parseSeatTab, seatTabHref, type SeatTab } from '@/lib/seat-plans-view';

function SeatPlansInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = parseSeatTab(sp.get('tab'));
  const firm = sp.get('firm');
  // Bumped when something changed, so lists that stay mounted elsewhere re-read.
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = useCallback(() => setRefreshKey((k) => k + 1), []);

  const go = useCallback((next: SeatTab, nextFirm: string | null = null) => {
    router.replace(seatTabHref(pathname, next, nextFirm), { scroll: false });
  }, [router, pathname]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-bold text-gray-900">Custom plan seats</h1>
      <Tabs items={SEAT_TABS.map((key) => ({ key, label: SEAT_TAB_LABELS[key] }))} active={tab} onChange={(k) => go(k as SeatTab)} />
      {tab === 'create' && (
        <CreateTab entityId={firm} onPick={(id) => go('create', id)} onOpenInPlans={(id) => go('plans', id)} onChanged={changed} />
      )}
      {tab === 'plans' && (
        <PlansTab openFirm={firm} onOpen={(id) => go('plans', id)} onEnded={() => { changed(); go('ended'); }} refreshKey={refreshKey} />
      )}
      {tab === 'history' && <HistoryTab refreshKey={refreshKey} />}
      {tab === 'ended' && <EndedTab refreshKey={refreshKey} />}
    </div>
  );
}

export default function SeatPlansPage() {
  return <Suspense fallback={<p className="p-6 text-xs text-gray-400">Loading…</p>}><SeatPlansInner /></Suspense>;
}
