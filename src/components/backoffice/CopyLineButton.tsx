'use client';
// Prompt 918 E.1 — a small copy icon for a line of text (the promo tree's "org · code · wave · date"): one click puts it on the clipboard,
// the icon turns into a tick, and a copy that did not work says so instead of showing the tick (writeToClipboard reports the truth).
// It stops the click from reaching the row underneath — copying a row must not also select it.
import { useEffect, useRef, useState } from 'react';
import { writeToClipboard } from '@/lib/clipboard';

export function CopyLineButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await writeToClipboard(text);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  }

  return (
    <button type="button" onClick={(e) => { void copy(e); }} aria-label={`Copy ${label}`} title={state === 'failed' ? 'Could not copy' : `Copy: ${text}`}
      data-copy-state={state}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 ${state === 'copied' ? 'text-emerald-600' : ''} ${state === 'failed' ? 'text-[#B00000]' : ''}`}>
      {state === 'copied' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      )}
      <span className="sr-only" role="status">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : ''}</span>
    </button>
  );
}
