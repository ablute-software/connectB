'use client';
// Prompt 404 §D.1 — moved out of TermsGateModal.tsx (removed by §D) so
// /set-password (§C.1) can keep using the exact same "does this signed-in
// user need to (re)accept the current Terms version" check, reading
// /api/terms/status — itself unchanged, still the single source of truth
// (shouldGateTerms in terms.ts). Kept in its own file rather than folded
// into terms.ts: that file is pure (no React), imported by server routes
// too — a hook belongs somewhere client-only.
import { useEffect, useState } from 'react';

export function useTermsGateStatus(): boolean | null {
  const [needsAcceptance, setNeedsAcceptance] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/terms/status').then((r) => r.json())
      .then((d) => { if (!cancelled) setNeedsAcceptance(!!d.needsAcceptance); })
      .catch(() => { if (!cancelled) setNeedsAcceptance(false); });
    return () => { cancelled = true; };
  }, []);
  return needsAcceptance;
}
