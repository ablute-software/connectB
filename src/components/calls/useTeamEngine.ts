'use client';
// Prompt 918 (follow-up to the I1 test) — how the Team tab saves. A click changes the screen AT ONCE; the save goes behind it, one request at a time and in the order of the clicks. Several
// clicks on the same switches within a moment are saved as ONE request carrying the last picture (the switches send the whole set, so nothing is lost). If the server refuses or cannot be
// reached, that change is taken out and the screen goes back to what the server last confirmed (plus the changes that are still on their way), with a short message. The server remains the
// authority: every answer is the whole picture, and it replaces the local one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TeamPayload } from '@/lib/calls/team-payload';
import { applyChanges, debounceKey, isOptimistic, type TeamChange } from '@/lib/calls/team-optimistic';
import { callsApi } from './api';

export const SAVE_DELAY_MS = 400;

interface Op { id: number; change: TeamChange; phase: 'wait' | 'queued' | 'sending'; resolve: (ok: boolean) => void }

export function useTeamEngine(callId: string) {
  const [confirmed, setConfirmed] = useState<TeamPayload | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [error, setError] = useState('');
  const [blocking, setBlocking] = useState(0);
  const opsRef = useRef<Op[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pumping = useRef(false);
  const nextId = useRef(1);

  const commit = useCallback((next: Op[]) => { opsRef.current = next; setOps(next); }, []);

  useEffect(() => {
    let alive = true;
    void callsApi.team(callId).then((r) => { if (!alive) return; if (r.ok) setConfirmed(r.body); else setError(r.body.error ?? 'Could not load the team.'); });
    return () => { alive = false; };
  }, [callId]);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const op = opsRef.current.find((o) => o.phase === 'queued');
        if (!op) break;
        commit(opsRef.current.map((o) => (o.id === op.id ? { ...o, phase: 'sending' as const } : o)));
        const waits = !isOptimistic(op.change);
        if (waits) setBlocking((n) => n + 1);
        let ok = false;
        try {
          const r = await callsApi.teamAction(callId, op.change);
          if (r.ok) { ok = true; setConfirmed(r.body); }
          else setError(`${r.body.error ?? 'That change was not accepted.'}${waits ? '' : ' Change undone.'}`);
        } catch {
          setError(`Could not save — check your connection.${waits ? '' : ' Change undone.'}`);
        }
        if (waits) setBlocking((n) => n - 1);
        // Taking the change out is what puts the screen back when it failed; when it worked, the server's picture already contains it.
        commit(opsRef.current.filter((o) => o.id !== op.id));
        op.resolve(ok);
      }
    } finally { pumping.current = false; }
  }, [callId, commit]);

  const release = useCallback((key: string) => {
    const t = timers.current.get(key); if (t) clearTimeout(t);
    timers.current.delete(key);
    commit(opsRef.current.map((o) => (o.phase === 'wait' && debounceKey(o.change) === key ? { ...o, phase: 'queued' as const } : o)));
    void pump();
  }, [commit, pump]);

  const releaseAll = useCallback(() => { for (const key of [...timers.current.keys()]) release(key); }, [release]);

  // Leaving the tab must not lose a switch that is still waiting its moment.
  useEffect(() => () => { for (const key of [...timers.current.keys()]) release(key); }, [release]);

  /** Makes a change. Resolves true when the server accepted it (for the ones that wait for the answer, this is how the form knows whether to clear itself). */
  const enqueue = useCallback((change: TeamChange): Promise<boolean> => {
    setError('');
    return new Promise<boolean>((resolve) => {
      const key = debounceKey(change);
      if (key) {
        const waiting = opsRef.current.find((o) => o.phase === 'wait' && debounceKey(o.change) === key);
        if (waiting) {
          // The earlier click is answered now (it is folded into this one); the last click carries the save.
          waiting.resolve(true);
          commit(opsRef.current.map((o) => (o.id === waiting.id ? { ...o, change, resolve } : o)));
          const old = timers.current.get(key); if (old) clearTimeout(old);
          timers.current.set(key, setTimeout(() => release(key), SAVE_DELAY_MS));
          return;
        }
        commit([...opsRef.current, { id: nextId.current++, change, phase: 'wait', resolve }]);
        timers.current.set(key, setTimeout(() => release(key), SAVE_DELAY_MS));
        return;
      }
      // Anything else goes straight after what is already waiting, so the order of the clicks is the order of the saves.
      releaseAll();
      commit([...opsRef.current, { id: nextId.current++, change, phase: 'queued', resolve }]);
      void pump();
    });
  }, [commit, pump, release, releaseAll]);

  const data = useMemo(() => (confirmed ? applyChanges(confirmed, ops.map((o) => o.change)) : null), [confirmed, ops]);
  return { data, error, setError, enqueue, blocking: blocking > 0, saving: ops.length > 0 };
}
