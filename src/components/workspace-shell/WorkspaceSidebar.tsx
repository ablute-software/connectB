'use client';
// Prompt 127 Bloco A — see types.ts for the WorkspaceNavItem contract this
// renders. `afterItems`/`footer` stay opaque ReactNode slots: founder's
// footer (email/role/logout or demo-mode note) and investor's (identity
// badge + sessionLabel + logout) are genuinely different content, not worth
// modeling internals for.
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import type { WorkspaceNavItem } from './types';

export function WorkspaceSidebar({ brandName, subtitle, beforeItems, items, afterItems, footer, groupStyle = 'dividers', collapsible = false }: {
  brandName: ReactNode;
  subtitle: string;
  // Prompt 576 §3 — opaque content between the brand header and the nav
  // list (the back-office's Operator-mode strip, exit button, and search).
  // Mirrors afterItems exactly: optional, additive, zero effect on any
  // caller that doesn't pass it.
  beforeItems?: ReactNode;
  items: WorkspaceNavItem[];
  afterItems?: ReactNode;
  footer: ReactNode;
  // Prompt 343/344 — 'cards' wraps each contiguous same-`group` run of
  // items in its own rounded-xl "island" with a soft outline shadow,
  // replacing the thin dividers-between-groups look (Prompt 314 §B) for
  // shells that opt in. Both modes read the SAME `group` field on each
  // item — no parallel grouping mechanism, so a shell only ever needs to
  // pick which rendering it wants. Default stays 'dividers' so every shell
  // that doesn't pass this explicitly (guest, investor-dataroom, any future
  // shell) is completely unaffected; a shell whose items carry no `group`
  // at all never opens/shows anything extra in either mode — an item is
  // only ever wrapped in a divider or a card when it actually HAS a group.
  groupStyle?: 'dividers' | 'cards';
  // Prompt 576 §5 — the back-office's 1280px ("13\"") tier: below the
  // custom 1440px cutover this opts into, the rail narrows to ~64px of
  // icons-only, matching the wireframe's "Responsive 1280" page while
  // leaving its own "Key screens 1440" page (and every non-backoffice
  // shell, which never passes this) at the full labeled width. Pure CSS —
  // both the label and the badge/dot each render twice, one copy visible
  // per side of the breakpoint, so nothing depends on a resize listener or
  // client-only state that could mismatch during SSR.
  collapsible?: boolean;
}) {
  const railWidth = collapsible ? 'w-16 min-[1440px]:w-60' : 'w-60';
  const hideWhenNarrow = collapsible ? 'hidden min-[1440px]:inline' : '';
  const hideBlockWhenNarrow = collapsible ? 'hidden min-[1440px]:block' : '';

  function renderItem(n: WorkspaceNavItem) {
    const className = `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition ${
      collapsible ? 'justify-center min-[1440px]:justify-start' : ''} ${
      n.active ? 'bg-[#0E7490] font-medium text-white shadow-sm'
        : n.dimmed ? 'text-gray-400 hover:bg-gray-50'
        : 'text-gray-600 hover:bg-gray-50'}`;
    const inner = (
      <>
        <span className={`w-4 text-center ${n.active ? '' : n.dimmed ? 'text-gray-300' : 'text-gray-400'}`}>{n.icon}</span>
        <span className={`${hideWhenNarrow} ${n.emphasize ? 'font-semibold tracking-wide' : ''}`}>{n.label}</span>
        {!!n.badge && (
          <span className={`${collapsible ? 'hidden min-[1440px]:ml-auto min-[1440px]:inline-block' : 'ml-auto inline-block'} rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-white`}>
            {n.badge}
          </span>
        )}
        {/* The collapsed rail's "número vira ponto" (§5) — same badge fact, drawn as a dot so it fits ~64px. */}
        {!!n.badge && collapsible && (
          <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-amber-400 min-[1440px]:hidden" />
        )}
      </>
    );
    const wrapperClass = collapsible ? `relative ${className}` : className;
    return n.href ? (
      <Link href={n.href} data-tour-id={n.tourId} title={collapsible ? n.label : undefined} className={wrapperClass}>{inner}</Link>
    ) : (
      <button onClick={n.onSelect} title={collapsible ? n.label : undefined} className={`w-full text-left ${wrapperClass}`}>{inner}</button>
    );
  }

  // Prompt 576 §3 — an uppercase label above a group's first item. Only
  // rendered when that item actually set one; founder/investor/guest items
  // never do, so this renders nothing for them.
  function renderGroupHeader(label: string | undefined, meta: ReactNode | undefined) {
    if (!label) return null;
    return (
      <div className={`flex items-center pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-gray-400 ${
        collapsible ? 'justify-center min-[1440px]:justify-between min-[1440px]:px-2.5' : 'justify-between px-2.5'}`}>
        <span className={hideWhenNarrow}>{label}</span>
        {meta}
      </div>
    );
  }

  // Contiguous runs of items sharing the same DEFINED group — an item with
  // no `group` always starts (and is) its own singleton run, so it's never
  // folded into a neighbour's card by accident.
  const runs: { group: number | undefined; items: WorkspaceNavItem[] }[] = [];
  for (const n of items) {
    const last = runs[runs.length - 1];
    if (last && n.group !== undefined && last.group === n.group) last.items.push(n);
    else runs.push({ group: n.group, items: [n] });
  }

  return (
    <aside className={`fixed inset-y-0 left-0 hidden ${railWidth} flex-col border-r border-gray-100 bg-white md:flex`}>
      <div className={collapsible ? 'px-2 pb-3 pt-6 text-center min-[1440px]:px-6 min-[1440px]:text-left' : 'px-6 pb-3 pt-6'}>
        <div className={`text-[26px] font-bold leading-none tracking-tight text-[#0E7490] ${hideBlockWhenNarrow}`} style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          {brandName}
        </div>
        <div className={`mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300 ${hideBlockWhenNarrow}`}>{subtitle}</div>
        {/* Prompt 576 §5 — the rail keeps SOME brand mark below 1440 rather
            than an empty header: the first letter, same teal as the
            wordmark it stands in for. */}
        {collapsible && (
          <div className="text-[22px] font-bold leading-none text-[#0E7490] min-[1440px]:hidden" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            {typeof brandName === 'string' ? brandName[0] : '·'}
          </div>
        )}
      </div>
      {beforeItems}
      <nav className={`mt-1 flex-1 space-y-0.5 overflow-y-auto pb-4 ${collapsible ? 'px-1.5 min-[1440px]:px-3' : 'px-3'}`}>
        {groupStyle === 'cards' ? (
          runs.map((run, ri) => (
            <Fragment key={ri}>
              {renderGroupHeader(run.items[0]?.groupLabel, run.items[0]?.groupMeta)}
              {run.group !== undefined ? (
                <div className={`space-y-0.5 rounded-xl border border-gray-100/80 bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,30,0.04),0_0_0_1px_rgba(15,23,30,0.03)] ${ri > 0 ? 'mt-2' : ''}`}>
                  {run.items.map((n) => <Fragment key={n.key}>{renderItem(n)}</Fragment>)}
                </div>
              ) : (
                run.items.map((n) => <Fragment key={n.key}>{renderItem(n)}</Fragment>)
              )}
            </Fragment>
          ))
        ) : (
          items.map((n, i) => {
            // Prompt 314 §B — a subtle divider wherever `group` changes
            // between consecutive items. Founder-only in practice pre-343:
            // the investor/guest shells never set `group`, so it stayed
            // undefined for every item there and this never fired. UNCHANGED
            // by 576 §3 — isNewGroup below is a separate, additive check.
            const prevGroup = i > 0 ? items[i - 1].group : undefined;
            const showDivider = n.group !== undefined && prevGroup !== undefined && n.group !== prevGroup;
            const isNewGroup = n.group !== undefined && (i === 0 || prevGroup !== n.group);
            return (
              <Fragment key={n.key}>
                {showDivider && <div className="my-2 border-t border-gray-100" />}
                {isNewGroup && renderGroupHeader(n.groupLabel, n.groupMeta)}
                {renderItem(n)}
              </Fragment>
            );
          })
        )}
        {afterItems}
      </nav>
      <div className={`border-t border-gray-100 py-3 ${collapsible ? 'px-2 min-[1440px]:px-4' : 'px-4'}`}>{footer}</div>
    </aside>
  );
}
