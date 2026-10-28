'use client';
// Prompt 923 (C) — the wait before another code may be asked for, counted down on the screen (the provider says "after 219 seconds"; the button stays off until then).
import { useCallback, useEffect, useState } from 'react';

/** `start(seconds)` begins; `left` is the whole seconds still to wait, 0 when nothing is running. */
export function useCountdown(): { left: number; start: (seconds: number) => void; stop: () => void } {
  const [until, setUntil] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (until === null) { setLeft(0); return; }
    const tick = () => { const n = Math.max(0, Math.ceil((until - Date.now()) / 1000)); setLeft(n); if (n === 0) setUntil(null); };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [until]);
  const start = useCallback((seconds: number) => setUntil(Date.now() + Math.max(1, Math.ceil(seconds)) * 1000), []);
  const stop = useCallback(() => setUntil(null), []);
  return { left, start, stop };
}
