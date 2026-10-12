'use client';
// Prompt 905 — does the signed-in person get the Calls tab in THIS workspace? Asked once, when the workspace
// mounts. The tab shows for whoever the role rules allow; only with CALLS_MODE explicitly "off" (or, if an
// allowlist is set, not on it) does the server answer 404 and the tab never appear.
import { useEffect, useState } from 'react';
import type { PromoterKind } from '@/lib/calls/types';
import { callsApi } from './api';

export function useCallsAccess(kind: PromoterKind): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    callsApi.access().then((res) => {
      if (alive) setEnabled(res.ok && (res.body.promoters ?? []).some((p) => p.kind === kind));
    });
    return () => { alive = false; };
  }, [kind]);
  return enabled;
}
