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
      // Prompt 504 §3 — os itens eram `text-xs` (12px) com `px-2.5 py-1`:
      // ~24px de altura de alvo, contra os ~44px que é o mínimo recomendado
      // para toque. Agora `min-h-[44px]` com padding e texto maiores. O
      // `overflow-x-auto` mantém-se (nunca cortar um item em telas
      // estreitas), e `pb-[env(safe-area-inset-bottom)]` impede que o último
      // item fique debaixo da barra de gestos num telemóvel com notch — a
      // altura real continua a ser MEDIDA pelo ResizeObserver do
      // bottom-nav-context, portanto o espaço que o conteúdo reserva por
      // baixo acompanha isto sozinho, sem número mágico em lado nenhum.
      // Sombra em vez de só um border-top: com 1px de linha cinzenta a barra
      // lia-se como parte do conteúdo, que é metade do que o Nuno reportou.
      <nav ref={ref} className="fixed inset-x-0 bottom-0 z-10 flex gap-1 overflow-x-auto border-t border-gray-200 bg-white px-2 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] md:hidden">
        {items.map((n) => {
          const className = `relative flex min-h-[44px] shrink-0 items-center px-3 py-2 text-[13px] ${n.active ? 'font-semibold text-[#0E7490]' : 'text-gray-500'} ${n.emphasize ? 'tracking-wide' : ''}`;
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
