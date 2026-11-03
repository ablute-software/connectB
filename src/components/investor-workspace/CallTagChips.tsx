'use client';
// Prompt 927 (A) — the tag on a pipeline card that came from a call of the firm. Its own file so it can be tested without the whole panel.
/** Prompt 927 (A): where a startup in the pipeline came from — a call of the firm. `state` only for whoever may see the applications of that call. */
export interface CallTag { callId: string; callName: string; applicationId: string; role: 'admin' | 'evaluator'; state: string | null; canOpen: boolean }

export function CallTagChips({ tags }: { tags: CallTag[] }) {
  return (
    <>
      {tags.map((t) => {
        const short = t.callName.length > 14 ? `${t.callName.slice(0, 13)}…` : t.callName;
        const label = `From call · ${short}${t.state ? ` · ${t.state}` : ''}`;
        const title = `From call: ${t.callName}${t.state ? ` — ${t.state}` : ''}${t.canOpen ? ' (click to open the application)' : ''}`;
        const cls = 'shrink-0 rounded-full bg-[#E8F4F8] px-2 py-0.5 text-[10px] font-semibold text-[#0A5F75]';
        return t.canOpen ? (
          <span key={t.callId} role="link" tabIndex={0} title={title} data-testid="call-tag" className={`${cls} cursor-pointer hover:underline`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); window.location.assign(`${window.location.pathname}?call=${t.callId}&section=${t.role === 'admin' ? 'applications' : 'evaluation'}`); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); window.location.assign(`${window.location.pathname}?call=${t.callId}&section=${t.role === 'admin' ? 'applications' : 'evaluation'}`); } }}>{label}</span>
        ) : <span key={t.callId} title={title} data-testid="call-tag" className={cls}>{label}</span>;
      })}
    </>
  );
}
