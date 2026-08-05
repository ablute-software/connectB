// Prompt 126 F introduced this as `PipeLoadingState`, pipeline-only, to fix
// the "0 rows vs not-loaded-yet" bug. Prompt 127 Bloco A (addenda §5)
// generalizes it into the app's one loading primitive: it's the only loading
// surface in the app with real brand identity (Sherlock Deal's detective-
// pipe motif, not a generic spinner) — no reason to run a second, plainer
// vocabulary alongside it, so this stays the default for every loading call
// site that adopts it, not just pipeline's.
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <style>{`
        @keyframes sd-pipe-smoke {
          0%   { transform: translate(0, 0) scale(0.4); opacity: 0; }
          15%  { opacity: 0.55; }
          100% { transform: translate(6px, -30px) scale(1.15); opacity: 0; }
        }
        .sd-pipe-smoke-1 { animation: sd-pipe-smoke 2.2s ease-out infinite; }
        .sd-pipe-smoke-2 { animation: sd-pipe-smoke 2.2s ease-out 0.7s infinite; }
        .sd-pipe-smoke-3 { animation: sd-pipe-smoke 2.2s ease-out 1.4s infinite; }
      `}</style>
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
        <circle className="sd-pipe-smoke-1" cx="34" cy="14" r="4" fill="#0E7490" />
        <circle className="sd-pipe-smoke-2" cx="34" cy="14" r="3.5" fill="#0E7490" />
        <circle className="sd-pipe-smoke-3" cx="34" cy="14" r="3" fill="#0E7490" />
        <path d="M10 38 Q10 30 18 30 H30 a6 6 0 0 1 6 6 v2 a6 6 0 0 1-6 6 H20" stroke="#0E7490" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <rect x="4" y="34" width="8" height="8" rx="2" fill="#0E7490" />
      </svg>
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  );
}
