'use client';
// Prompt 603 §C / Prompt 604 §A — the founder-side redirect into
// /welcome/commitments, once per account (a plain "seen" mark, never a
// version), only when the server says the gate is on and this signed-in
// founder has not been marked as having seen it. Client-only (a hook), same
// split as terms-status.ts; the decision itself is server-side.
import { useEffect } from 'react';

export function useCommitmentsGate(active: boolean, currentPath: string | null) {
  useEffect(() => {
    if (!active || !currentPath) return;
    if (currentPath.startsWith('/welcome/commitments')) return;
    let cancelled = false;
    fetch('/api/commitments/status', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      if (cancelled || !d?.shouldShow) return;
      window.location.replace(`/welcome/commitments?next=${encodeURIComponent(currentPath)}`);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [active, currentPath]);
}
