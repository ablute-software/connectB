'use client';
// Shared ?tab= state for pages that merged several old routes into one with
// separadores (Today/Agenda, Dashboard/Review & Optimization, Queue,
// Settings). The active tab lives in the URL — never component state alone —
// so it's linkable, survives refresh, and survives back/forward. Same
// useSearchParams pattern already used in this repo (log/page.tsx,
// signup/page.tsx, login/page.tsx): the caller wraps its default export in
// <Suspense>, exactly like those pages do.
//
// The default tab is omitted from the URL (bare /today, not /today?tab=today)
// so the common case stays a clean URL; only non-default tabs add ?tab=.
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useTabParam(defaultTab: string, paramName = 'tab'): [string, (tab: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const active = sp.get(paramName) || defaultTab;

  const setActive = useCallback((tab: string) => {
    const params = new URLSearchParams(sp.toString());
    if (tab === defaultTab) params.delete(paramName);
    else params.set(paramName, tab);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp, defaultTab, paramName]);

  return [active, setActive];
}
