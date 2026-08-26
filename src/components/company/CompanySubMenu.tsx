'use client';
// Prompt 377 §B — the left sub-menu for the Company tab's 7 sections.
// Prompt 394 §2 — was scrollspy via IntersectionObserver, rooted on the
// content column. That column stopped being a real scroll container once
// CompanyPanel switched to true tabs (only the active section mounts, so
// there's nothing left for an observer to watch scroll past) — this is now
// a plain controlled tab list: `active`/`onSelect` are owned by
// CompanyPanel, this component just renders and reports clicks.
//
// `data-tour-id={s.anchorId}` lives on these buttons (not on the section
// content anymore, since only the active one is ever mounted) — the
// settings tour's Identity/Round/Traction steps spotlight the nav item
// that leads to each section, which stays resolvable regardless of which
// section is currently showing.
export interface CompanySection { key: string; label: string; anchorId: string }

export function CompanySubMenu({ sections, active, onSelect }: {
  sections: CompanySection[]; active: string; onSelect: (key: string) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
      {sections.map((s) => (
        <button key={s.key} data-tour-id={s.anchorId} onClick={() => onSelect(s.key)}
          className={`shrink-0 rounded-full px-2.5 py-1.5 text-left text-xs font-medium lg:block lg:w-full lg:rounded-lg ${
            active === s.key ? 'bg-[#E8F4F8] text-[#0E7490]' : 'border border-gray-200 text-gray-600 hover:bg-gray-50 lg:border-0'}`}>
          {s.label}
        </button>
      ))}
    </nav>
  );
}
