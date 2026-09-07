'use client';
// Prompt 603 §C — the founder-side redirect into /welcome/commitments, once
// per version, only when the server says the gate is on and this signed-in
// founder has not accepted the current version. Client-only (a hook), same
// split as terms-status.ts; the decision itself is server-side.
import { useEffect } from 'react';

export function useCommitmentsGate(active: boolean, currentPath: string | null) {
  useEffect(() => {
    if (!active || !currentPath) return;
    if (currentPath.startsWith('/welcome/commitments')) return;
    let cancelled = false;
    fetch('/api/commitments/status', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      if (cancelled || !d?.needsAcceptance) return;
      window.location.replace(`/welcome/commitments?next=${encodeURIComponent(currentPath)}`);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [active, currentPath]);
}
