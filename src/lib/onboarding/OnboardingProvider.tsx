'use client';
// Wires the pure engine (engine.ts) to real persistence (onboarding_state,
// migration 0043) and in-memory session counters. Session = this mounted
// lifetime of the provider (i.e. this browser tab load) — a full reload
// starts a fresh session, which is the same granularity the interruption
// budget in §2 is written against.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { ONBOARDING_CONTENT } from './content';
import { pickEligible, type OnboardingCtx } from './engine';

interface OnboardingRow { seen: Record<string, string>; opted_out: boolean; last_shown_at: string | null }

interface OnboardingContextValue {
  /** The single item currently eligible to render, or null. Components compare their own key against this. */
  eligibleKey: string | null;
  /** A component registers whether ITS item's trigger condition currently holds (default false until set). */
  setCondition: (key: string, value: boolean) => void;
  /** Mark a key as shown+dismissed — persists to onboarding_state and updates session counters. */
  markSeen: (key: string) => void;
  /** Settings -> "Rever dicas": clears `seen` so everything can resurface. Does not reset session counters/budget. */
  resetSeen: () => void;
  loaded: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [row, setRow] = useState<OnboardingRow>({ seen: {}, opted_out: false, last_shown_at: null });
  const [loaded, setLoaded] = useState(false);
  const [conditions, setConditions] = useState<Record<string, boolean>>({});
  const [sessionModalsShown, setSessionModalsShown] = useState(0);
  const [sessionCoachmarksShown, setSessionCoachmarksShown] = useState(0);

  useEffect(() => {
    if (!authEnabled) { setLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const sb = browserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { if (!cancelled) setLoaded(true); return; }
      const { data } = await sb.from('onboarding_state').select('seen, opted_out, last_shown_at').eq('user_id', user.id).maybeSingle();
      if (cancelled) return;
      if (data) setRow({ seen: (data.seen as Record<string, string>) ?? {}, opted_out: data.opted_out, last_shown_at: data.last_shown_at });
      else await sb.from('onboarding_state').insert({ user_id: user.id }); // first-ever session for this user
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const setCondition = useCallback((key: string, value: boolean) => {
    setConditions((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const eligibleKey = useMemo(() => {
    if (!loaded) return null;
    const ctx: OnboardingCtx = {
      seen: row.seen, optedOut: row.opted_out, lastShownAt: row.last_shown_at, now: new Date(),
      sessionModalsShown, sessionCoachmarksShown, conditions,
    };
    return pickEligible(ONBOARDING_CONTENT, ctx)?.key ?? null;
  }, [loaded, row, sessionModalsShown, sessionCoachmarksShown, conditions]);

  const markSeen = useCallback((key: string) => {
    const item = ONBOARDING_CONTENT.find((i) => i.key === key);
    const nowIso = new Date().toISOString();
    setRow((prev) => ({
      ...prev,
      seen: { ...prev.seen, [key]: nowIso },
      last_shown_at: item?.type === 'modal' ? nowIso : prev.last_shown_at,
    }));
    if (item?.type === 'modal') setSessionModalsShown((n) => n + 1);
    else if (item?.type === 'coachmark') setSessionCoachmarksShown((n) => n + 1);

    if (!authEnabled) return;
    (async () => {
      const sb = browserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      // Read-modify-write on `seen` rather than a blind overwrite — two
      // onboarding moments could in principle resolve in the same tick.
      const { data } = await sb.from('onboarding_state').select('seen').eq('user_id', user.id).maybeSingle();
      const nextSeen = { ...((data?.seen as Record<string, string>) ?? {}), [key]: nowIso };
      const patch: Partial<OnboardingRow> = { seen: nextSeen };
      if (item?.type === 'modal') patch.last_shown_at = nowIso;
      await sb.from('onboarding_state').update(patch).eq('user_id', user.id);
    })();
  }, []);

  const resetSeen = useCallback(() => {
    setRow((prev) => ({ ...prev, seen: {} }));
    if (!authEnabled) return;
    (async () => {
      const sb = browserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      await sb.from('onboarding_state').update({ seen: {} }).eq('user_id', user.id);
    })();
  }, []);

  return (
    <OnboardingContext.Provider value={{ eligibleKey, setCondition, markSeen, resetSeen, loaded }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
