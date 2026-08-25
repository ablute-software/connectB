'use client';
// Prompt 377 §B — the left sub-menu for the Company tab's 7 sections.
// Scrollspy via IntersectionObserver, rooted on the CONTENT column itself
// (not the viewport) since that's the only element that actually scrolls in
// the new layout — no new dependency, same discipline the prompt asked for.
import { useEffect, useState } from 'react';

export interface CompanySection { key: string; label: string; anchorId: string }

export function CompanySubMenu({ sections, scrollRoot }: { sections: CompanySection[]; scrollRoot: HTMLDivElement | null }) {
  const [active, setActive] = useState(sections[0]?.key ?? '');

  useEffect(() => {
    if (!scrollRoot) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const topKey = visible[0] && sections.find((s) => s.anchorId === visible[0].target.id)?.key;
      if (topKey) setActive(topKey);
    }, { root: scrollRoot, rootMargin: '0px 0px -70% 0px', threshold: 0 });
    const elements = sections.map((s) => document.getElementById(s.anchorId)).filter((el): el is HTMLElement => !!el);
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [sections, scrollRoot]);

  function jump(anchorId: string) {
    document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
      {sections.map((s) => (
        <button key={s.key} onClick={() => jump(s.anchorId)}
          className={`shrink-0 rounded-full px-2.5 py-1.5 text-left text-xs font-medium lg:block lg:w-full lg:rounded-lg ${
            active === s.key ? 'bg-[#E8F4F8] text-[#0E7490]' : 'border border-gray-200 text-gray-600 hover:bg-gray-50 lg:border-0'}`}>
          {s.label}
        </button>
      ))}
    </nav>
  );
}
