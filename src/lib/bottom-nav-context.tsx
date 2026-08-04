'use client';
// Prompt 125 Block A — lets ReportProblemWidget (mounted once, globally, in
// the root layout — a SIBLING of the page tree, not a descendant of
// whichever bottom nav is currently on screen) know how tall the active
// page's own bottom nav actually is, so it can float above it instead of
// landing on top of the last item ("Profile" on MatchDeal, confirmed by
// screenshot). A plain "route exception" list was rejected on purpose —
// every current AND future bottom-nav surface (MatchDeal's tab bar, the
// founder shell's mobile nav) registers itself here instead.
//
// Real measurement (ResizeObserver), not a hardcoded guess — each nav's
// rendered height already bakes in env(safe-area-inset-bottom), which
// varies by device (notch vs. no notch), so a static px number would be
// wrong on some phones by design.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

interface BottomNavContextValue { height: number; setHeight: (h: number) => void }
const BottomNavContext = createContext<BottomNavContextValue>({ height: 0, setHeight: () => {} });

export function BottomNavHeightProvider({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState(0);
  return <BottomNavContext.Provider value={{ height, setHeight }}>{children}</BottomNavContext.Provider>;
}

export function useBottomNavHeight(): number {
  return useContext(BottomNavContext).height;
}

// Call from any component that renders a fixed bottom nav, passing a ref to
// the nav element itself. Reports 0 on unmount (navigating away from a page
// with a bottom nav must not leave a stale offset behind for the next page).
export function useRegisterBottomNav(ref: RefObject<HTMLElement | null>): void {
  const { setHeight } = useContext(BottomNavContext);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => { observer.disconnect(); setHeight(0); };
  }, [ref, setHeight]);
}

export function useBottomNavRef<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useRegisterBottomNav(ref);
  return ref;
}
