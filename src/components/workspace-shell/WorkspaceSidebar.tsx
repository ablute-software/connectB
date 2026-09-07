'use client';
// Prompt 127 Bloco A — see types.ts for the WorkspaceNavItem contract this
// renders. `afterItems`/`footer` stay opaque ReactNode slots: founder's
// footer (email/role/logout or demo-mode note) and investor's (identity
// badge + sessionLabel + logout) are genuinely different content, not worth
// modeling internals for.
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkspaceNavItem } from './types';

// Prompt 585 §B — user-resizable width, backoffice sidebar only (the design
// artifact's own 300px is the default; neither Navigation.dc.html nor
// Main.dc.html anticipates manual resize, this is a new Nuno request, not a
// reconciliation to spec). Starting bounds, adjustable to real rendered
// text later: 220px is the narrowest that keeps "Promo codes & offers" and
// "Usage · AI costs" on one line; 420px is a generous cap before the content
// column starts feeling cramped on a 1440px viewport. Dragging below the
// minimum clamps there rather than snapping into the icon rail — simpler to
// get right than unifying two independent width mechanisms (this JS-driven
// one and the icon rail's own pure-CSS 1440px breakpoint), and the doc
// itself says either choice is fine as long as it's decided and documented.
const WIDTH_KEY = 'sd-backoffice-sidebar-width';
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 300;

export function WorkspaceSidebar({
  brandName, subtitle, beforeItems, items, afterItems, footer, groupStyle = 'dividers', collapsible = false, theme = 'light',
}: {
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
  // Prompt 585 §A — 'dark' is the back-office's own theme (Navigation.dc.html),
  // used ONLY when the caller opts in. Default 'light' keeps founder/
  // investor/guest sidebars byte-for-byte unchanged — none of them pass this.
  theme?: 'light' | 'dark';
}) {
  const dark = theme === 'dark';
  const hideWhenNarrow = collapsible ? 'hidden min-[1440px]:inline' : '';
  const hideBlockWhenNarrow = collapsible ? 'hidden min-[1440px]:block' : '';

  // Prompt 585 §B — read the saved width only after mount (localStorage
  // doesn't exist during SSR); a hydration frame at DEFAULT_WIDTH before the
  // real preference applies is the accepted, standard tradeoff for a
  // desktop-only, below-the-fold-irrelevant preference like this one.
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!collapsible) return;
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
    } catch { /* private browsing, storage disabled — default stands */ }
  }, [collapsible]);

  // Prompt 589 — --sb-w has to live on the document root, not as an inline
  // style on this <aside>: a custom property set that way is only visible
  // to the aside's OWN descendants, never to a SIBLING like BackofficeShell's
  // content wrapper (CSS custom properties cascade down, never sideways).
  // That mismatch is exactly what Nuno's drag test found — the sidebar
  // resized, the content's left margin (a separate, static ml-60) never
  // moved with it, overlapping the header on one side and leaving a gap on
  // the other. Setting it on documentElement makes it a real shared value
  // both the aside's own width AND the content margin can read.
  useEffect(() => {
    if (!collapsible) return;
    document.documentElement.style.setProperty('--sb-w', `${width}px`);
    // No cleanup here on purpose — this effect re-runs on every width tick
    // while dragging, and a cleanup tied to those same deps would remove-
    // then-reset the property every frame. Clearing on true unmount only
    // is the separate, empty-deps effect below.
  }, [collapsible, width]);
  useEffect(() => () => { document.documentElement.style.removeProperty('--sb-w'); }, []);

  const onDragStart = useCallback((startEvent: React.MouseEvent) => {
    startEvent.preventDefault();
    draggingRef.current = true;
    const startX = startEvent.clientX;
    const startWidth = width;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (e.clientX - startX)));
      setWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setWidth((current) => {
        try { localStorage.setItem(WIDTH_KEY, String(current)); } catch { /* ignore */ }
        return current;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  const railWidth = collapsible ? 'w-16 min-[1440px]:w-[var(--sb-w)]' : 'w-60';
  const asideTheme = dark ? 'border-[var(--sb-border)] bg-[var(--sb-bg)]' : 'border-gray-100 bg-white';
  const brandTextTheme = dark ? 'text-[var(--sb-text)]' : 'text-[#0E7490]';
  const subtitleTheme = dark ? 'text-[var(--sb-dim)]' : 'text-gray-300';
  const groupLabelTheme = dark ? 'text-[var(--sb-dim)]' : 'text-gray-400';
  const footerBorderTheme = dark ? 'border-[var(--sb-border)]' : 'border-gray-100';

  function renderItem(n: WorkspaceNavItem) {
    const className = `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition ${
      collapsible ? 'justify-center min-[1440px]:justify-start' : ''} ${
      n.active ? (dark ? 'bg-[var(--sb-active)] text-[var(--sb-text)]' : 'bg-[#0E7490] font-medium text-white shadow-sm')
        : n.dimmed ? (dark ? 'text-[var(--sb-dim)] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-50')
        : (dark ? 'text-[var(--sb-text)] hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50')}`;
    const iconTheme = n.active ? '' : n.dimmed ? (dark ? 'text-[var(--sb-dim)] opacity-60' : 'text-gray-300') : (dark ? 'text-[var(--sb-dim)]' : 'text-gray-400');
    // Prompt 585 §A — the one badge allowed to break the blue family: the
    // aggregate "Attention" total, in --sb-danger with white text (matching
    // the reference exactly). Every other badge (section or per-item count)
    // stays --sb-badge/--sb-text. Light theme is entirely unaffected —
    // amber stays amber regardless of badgeDanger, since only the dark
    // back-office sidebar ever sets it.
    const badgeTheme = dark
      ? (n.badgeDanger ? 'bg-[var(--sb-danger)] text-white' : 'bg-[var(--sb-badge)] text-[var(--sb-text)]')
      : 'bg-amber-400 text-white';
    const dotTheme = dark ? (n.badgeDanger ? 'bg-[var(--sb-danger)]' : 'bg-[var(--sb-badge)]') : 'bg-amber-400';
    const inner = (
      <>
        <span className={`w-4 text-center ${iconTheme}`}>{n.icon}</span>
        <span className={`${hideWhenNarrow} ${n.emphasize ? 'font-semibold tracking-wide' : ''}`}>{n.label}</span>
        {!!n.badge && (
          <span className={`${collapsible ? 'hidden min-[1440px]:ml-auto min-[1440px]:inline-block' : 'ml-auto inline-block'} rounded-full px-1.5 text-[10px] font-bold ${badgeTheme}`}>
            {n.badge}
          </span>
        )}
        {/* The collapsed rail's "número vira ponto" (§5) — same badge fact, drawn as a dot so it fits ~64px. */}
        {!!n.badge && collapsible && (
          <span className={`absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full min-[1440px]:hidden ${dotTheme}`} />
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
      <div className={`flex items-center pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-wider ${groupLabelTheme} ${
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
    <aside
      className={`fixed inset-y-0 left-0 hidden ${railWidth} flex-col border-r md:flex ${asideTheme}`}
      style={collapsible ? ({ '--sb-w': `${width}px` } as React.CSSProperties) : undefined}
    >
      <div className={collapsible ? 'px-2 pb-3 pt-6 text-center min-[1440px]:px-6 min-[1440px]:text-left' : 'px-6 pb-3 pt-6'}>
        <div className={`text-[26px] font-bold leading-none tracking-tight ${brandTextTheme} ${hideBlockWhenNarrow}`} style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          {brandName}
        </div>
        <div className={`mt-1.5 text-[11px] font-medium uppercase tracking-widest ${subtitleTheme} ${hideBlockWhenNarrow}`}>{subtitle}</div>
        {/* Prompt 576 §5 — the rail keeps SOME brand mark below 1440 rather
            than an empty header: the first letter, same accent as the
            wordmark it stands in for. */}
        {collapsible && (
          <div className={`text-[22px] font-bold leading-none min-[1440px]:hidden ${brandTextTheme}`} style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            {typeof brandName === 'string' ? brandName[0] : '·'}
          </div>
        )}
      </div>
      {beforeItems}
      {/* Prompt 593 §B — sd-dark-scrollbar (globals.css) restyles the
          native scrollbar to the same blue-258/260 family as the rest of
          the shell; the browser default (white track, gray thumb) read as
          a rendering error against --sb-bg. Dark theme only — founder/
          investor/guest keep the plain native scrollbar. */}
      <nav className={`mt-1 flex-1 space-y-0.5 overflow-y-auto pb-4 ${dark ? 'sd-dark-scrollbar' : ''} ${collapsible ? 'px-1.5 min-[1440px]:px-3' : 'px-3'}`}>
        {groupStyle === 'cards' ? (
          runs.map((run, ri) => (
            <Fragment key={ri}>
              {renderGroupHeader(run.items[0]?.groupLabel, run.items[0]?.groupMeta)}
              {run.group !== undefined ? (
                <div className={`space-y-0.5 rounded-xl p-1.5 ${ri > 0 ? 'mt-2' : ''} ${
                  dark ? 'border border-white/5 bg-white/[0.02]' : 'border border-gray-100/80 bg-white shadow-[0_1px_2px_rgba(15,23,30,0.04),0_0_0_1px_rgba(15,23,30,0.03)]'}`}>
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
                {showDivider && <div className={`my-2 border-t ${dark ? 'border-white/10' : 'border-gray-100'}`} />}
                {isNewGroup && renderGroupHeader(n.groupLabel, n.groupMeta)}
                {renderItem(n)}
              </Fragment>
            );
          })
        )}
        {afterItems}
      </nav>
      <div className={`border-t py-3 ${collapsible ? 'px-2 min-[1440px]:px-4' : 'px-4'} ${footerBorderTheme}`}>{footer}</div>
      {/* Prompt 585 §B, revised 593/595 §A — drag handle, expanded state
          only (below the 1440px breakpoint the rail is the fixed 64px
          icon strip; resizing that makes no sense). Sits INSIDE the aside,
          to the left of the scrollbar's own ~8px gutter (right-2 w-1.5 =
          an 8-14px-from-edge strip; the scrollbar below claims 0-8px).
          595 §A, Nuno's own words: "o que acontece normalmente noutros
          sites é a linha não aparecer... mas aparecer o símbolo do mexer
          divisória" — 593 still drew a line on hover/drag; this draws
          NOTHING, ever, in any state. cursor:col-resize is the only
          affordance a mouse over this strip gets. */}
      {collapsible && (
        <div
          onMouseDown={onDragStart}
          title="Drag to resize"
          className="absolute inset-y-0 right-2 z-10 hidden w-1.5 cursor-col-resize min-[1440px]:block"
        />
      )}
    </aside>
  );
}
