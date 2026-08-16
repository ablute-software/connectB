'use client';
// Prompt 215 — o popover do badge 📄 do stepper, agora flutuante.
//
// Estava inline dentro do cartão e o sintoma era exactamente o que a regra
// do CLAUDE.md descreve: um antecessor com overflow/transform clipa a caixa.
// Nos screenshots via-se a caixa cortada, setas de scroll ▲▼ e o conteúdo do
// cartão a deslocar-se — não é um problema de largura do popover, é do
// contentor. O DocPreviewModal (206-C) já vivia em portal; este ficou para
// trás. Uniformizado.
//
// Só o CONTENTOR muda: o conteúdo é o mesmo do 209 (nome, data, "open" e
// "see in history").
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface BadgeDoc { key: string; name: string; at: string }

// Largura fixa para o cálculo de posição poder ser exacto — medir depois de
// montar dava um salto visível no primeiro frame.
const WIDTH = 256;
const MARGIN = 8;

export function DocBadgePopover({ anchor, docs, onOpen, onSeeInHistory, onClose }: {
  // O rectângulo do badge no momento do clique (getBoundingClientRect).
  anchor: DOMRect;
  docs: BadgeDoc[];
  onOpen: (key: string) => void;
  onSeeInHistory?: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey);
    // `mousedown` e não `click`: o clique que abriu o popover ainda está a
    // propagar-se, e com `click` fechava-se a si próprio no mesmo gesto.
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  if (!mounted || typeof document === 'undefined') return null;

  // Ancorado ao badge, preso ao viewport. `fixed` porque o rect vem em
  // coordenadas de viewport; sair fora à direita ou em baixo é o caso comum
  // num stepper que já rola na horizontal.
  const left = Math.min(Math.max(MARGIN, anchor.left), window.innerWidth - WIDTH - MARGIN);
  const belowTop = anchor.bottom + 6;
  const openUpwards = belowTop + 160 > window.innerHeight;
  const style: React.CSSProperties = openUpwards
    ? { left, bottom: window.innerHeight - anchor.top + 6, width: WIDTH }
    : { left, top: belowTop, width: WIDTH };

  return createPortal(
    <div ref={ref} style={{ position: 'fixed', zIndex: 60, ...style }}
      className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
      {docs.map((d) => (
        <div key={d.key} className="border-b border-gray-100 py-1 last:border-0">
          <p className="truncate text-[11px] font-medium text-gray-900" title={d.name}>{d.name}</p>
          <p className="text-[10px] text-gray-400">{d.at.slice(0, 10)}</p>
          <div className="mt-0.5 flex gap-2">
            <button onClick={() => { onOpen(d.key); onClose(); }}
              className="text-[11px] font-medium text-[#0E7490] hover:underline">open</button>
            {onSeeInHistory && (
              <button onClick={() => { onSeeInHistory(d.key); onClose(); }}
                className="text-[11px] font-medium text-[#0E7490] hover:underline">see in history</button>
            )}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
