'use client';
// Prompt 127 Bloco A (addenda §3) — real bug found while designing this
// primitive: the investor workspace has NO mobile navigation at all. Its
// <aside> is `hidden md:flex` exactly like the founder's, but the founder
// has always had this fixed bottom tab strip as the `md:hidden` fallback
// (shell.tsx) and the investor never got an equivalent — below ~768px an
// investor has no way to switch tabs. Fixed here, not deferred: the same
// WorkspaceNavItem list already built for WorkspaceSidebar drives this too,
// so extracting the primitive correctly fixes it for free.
import { forwardRef } from 'react';
import Link from 'next/link';
import type { WorkspaceNavItem } from './types';

export const WorkspaceMobileNav = forwardRef<HTMLElement, { items: WorkspaceNavItem[] }>(
  function WorkspaceMobileNav({ items }, ref) {
    return (
      // All items, never cut down — width overflow scrolls horizontally
      // instead of hiding one; relative positioning keeps each badge pinned
      // to its own link.
      <nav ref={ref} className="fixed inset-x-0 bottom-0 z-10 flex gap-1 overflow-x-auto border-t border-gray-100 bg-white px-2 py-1.5 md:hidden">
        {items.map((n) => {
          const className = `relative shrink-0 px-2.5 py-1 text-xs ${n.active ? 'font-semibold text-[#0E7490]' : 'text-gray-400'} ${n.emphasize ? 'tracking-wide' : ''}`;
          const inner = (
            <>
              {n.label}
              {!!n.badge && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-400 px-1 text-[9px] font-bold text-white">{n.badge}</span>
              )}
            </>
          );
          return n.href ? (
            <Link key={n.key} href={n.href} className={className}>{inner}</Link>
          ) : (
            <button key={n.key} onClick={n.onSelect} className={className}>{inner}</button>
          );
        })}
      </nav>
    );
  },
);
