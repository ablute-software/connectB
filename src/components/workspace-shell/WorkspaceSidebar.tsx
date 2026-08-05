'use client';
// Prompt 127 Bloco A — see types.ts for the WorkspaceNavItem contract this
// renders. `afterItems`/`footer` stay opaque ReactNode slots: founder's
// footer (email/role/logout or demo-mode note) and investor's (identity
// badge + sessionLabel + logout) are genuinely different content, not worth
// modeling internals for.
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { WorkspaceNavItem } from './types';

export function WorkspaceSidebar({ brandName, subtitle, items, afterItems, footer }: {
  brandName: ReactNode;
  subtitle: string;
  items: WorkspaceNavItem[];
  afterItems?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex">
      <div className="px-6 pb-3 pt-6">
        <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          {brandName}
        </div>
        <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">{subtitle}</div>
      </div>
      <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {items.map((n) => {
          const className = `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition ${
            n.active ? 'bg-[#0E7490] font-medium text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`;
          const inner = (
            <>
              <span className={`w-4 text-center ${n.active ? '' : 'text-gray-400'}`}>{n.icon}</span>
              <span className={n.emphasize ? 'font-semibold tracking-wide' : undefined}>{n.label}</span>
              {!!n.badge && (
                <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-white">{n.badge}</span>
              )}
            </>
          );
          return n.href ? (
            <Link key={n.key} href={n.href} data-tour-id={n.tourId} className={className}>{inner}</Link>
          ) : (
            <button key={n.key} onClick={n.onSelect} className={`w-full text-left ${className}`}>{inner}</button>
          );
        })}
        {afterItems}
      </nav>
      <div className="border-t border-gray-100 px-4 py-3">{footer}</div>
    </aside>
  );
}
