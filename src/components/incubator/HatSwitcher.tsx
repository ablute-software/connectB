'use client';
// Prompt I-01 §B.4 — the hat switcher, and since Prompt 923 (A) the AREA SELECTOR of the menu: it lists every area this account can open (founder / ecosystem / investor workspace / data rooms — only the ones the
// person has, src/lib/areas.ts), marks the one they are in, and takes them to the others. It also remembers the area this page belongs to (a cookie), so the next sign-in lands where they were last (/go).
// Nothing is shown to somebody who has a single area: there is nothing to switch to.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { lastAreaCookie, selectorOptions, type Area } from '@/lib/areas';

export interface Hats { founder: boolean; incubator: boolean; investor: boolean }
/** The shells still call themselves by the old names; 'incubator' is the ecosystem area. */
type Current = Area | 'incubator';

const fromHats = (h: Hats | null | undefined): Area[] => (h ? ([h.founder && 'founder', h.incubator && 'ecosystem', h.investor && 'investor'].filter(Boolean) as Area[]) : []);

export function HatSwitcher({ current, hats: givenHats, areas: givenAreas, tone = 'light' }: { current: Current; hats?: Hats | null; areas?: Area[] | null; tone?: 'light' | 'dark' }) {
  const here: Area = current === 'incubator' ? 'ecosystem' : current;
  const [areas, setAreas] = useState<Area[] | null>(givenAreas ?? (givenHats ? fromHats(givenHats) : null));
  useEffect(() => {
    if (givenAreas !== undefined || givenHats !== undefined) { setAreas(givenAreas ?? fromHats(givenHats)); return; }
    fetch('/api/me').then((r) => r.json()).then((me) => setAreas(Array.isArray(me?.areas) ? me.areas : fromHats(me?.hats))).catch(() => setAreas(null));
  }, [givenAreas, givenHats]);
  // Remember the area this page is, for the next sign-in (the cookie is a convenience: /go ignores a value the person no longer has).
  useEffect(() => { try { document.cookie = lastAreaCookie(here); } catch { /* cookies blocked: the sign-in simply falls back to the first area */ } }, [here]);

  const options = selectorOptions(areas ?? []);
  if (options.length < 2) return null;
  return (
    <nav className="px-1 pt-3" aria-label="Area" data-testid="area-selector">
      <div className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest ${tone === 'dark' ? 'text-gray-500' : 'text-gray-300'}`}>Your areas</div>
      {options.map((o) => (o.area === here
        ? (
          <div key={o.area} aria-current="page" data-testid="area-current"
            className="mb-1 flex items-center gap-2.5 rounded-xl border border-[#0E7490] bg-[#E8F4F8] px-3 py-2 text-[13.5px] font-semibold text-[#0E7490]">
            <span className="w-4 text-center">✓</span> {o.label}
          </div>
        ) : (
          <Link key={o.area} href={o.href} data-testid="area-option" onClick={() => { try { document.cookie = lastAreaCookie(o.area); } catch { /* see above */ } }}
            className="mb-1 flex items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13.5px] text-gray-700 transition hover:bg-gray-100">
            <span className="w-4 text-center text-gray-400">⇄</span> {o.label}
          </Link>
        )))}
    </nav>
  );
}
