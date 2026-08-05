'use client';
// Prompt 127 Bloco A (addenda §2) — the cyclic-colour/shine <style> block and
// trigger button were copied byte-for-byte between the two shells, differing
// only in which `kind` gets passed to MatchDealPairingModal. Consolidated
// here with the modal's own open/close state, so neither shell needs its own
// `showMatchDeal` boolean anymore — permanent, colour-highlighted header
// button (not a static multi-colour gradient: the background cycles through
// one solid colour at a time, blue -> green -> orange -> blue, looping, with
// a light-sweep overlay on top the whole time — same shimmer technique as
// CompletenessBar.tsx's 100%-complete celebration, just looping instead of
// one-shot). Label collapses to icon-only below `sm` — the header row runs
// edge-to-edge with zero slack at ~680px without it.
import { useState } from 'react';
import { Tooltip } from '@/components/ui';
import { MatchDealPairingModal } from '@/components/matchdeal/MatchDealPairingModal';

export function MatchDealButton({ kind, tooltip }: { kind: 'startup' | 'investor'; tooltip: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <style>{`
        @keyframes sd-header-shine { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes sd-matchdeal-cycle {
          0%, 20%    { background-color: #3B82F6; }
          33.33%     { background-color: #22C55E; }
          53.33%     { background-color: #22C55E; }
          66.66%     { background-color: #F97316; }
          86.66%     { background-color: #F97316; }
          100%       { background-color: #3B82F6; }
        }
        .sd-matchdeal-shine { animation: sd-header-shine 2.6s ease-in-out infinite; }
        .sd-matchdeal-cycle { animation: sd-matchdeal-cycle 9s ease-in-out infinite; }
      `}</style>
      <Tooltip text={tooltip} side="bottom">
        <button onClick={() => setShow(true)}
          className="sd-matchdeal-cycle relative flex items-center gap-1.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-[0_10px_24px_rgba(34,197,94,.4)] sm:px-3">
          <span aria-hidden="true" className="sd-matchdeal-shine pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          <span aria-hidden="true" className="relative text-base leading-none">🤝</span>
          <span className="relative hidden sm:inline">MatchDeal</span>
        </button>
      </Tooltip>
      {show && <MatchDealPairingModal kind={kind} onClose={() => setShow(false)} />}
    </>
  );
}
