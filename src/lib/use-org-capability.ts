'use client';
// Prompt 852 §B — one client-side answer to "may this member do X", so the
// Pipeline row and the entity dossier hide the same controls from the same
// people, and neither has to re-derive the matrix.
//
// This is a COURTESY, never the gate. Every write goes through a route that
// calls canWithMatrix itself against the same resolved matrix; hiding a
// button only stops a member from being offered something that would be
// refused. Fail CLOSED on any error: a failed fetch must not hand a member a
// capability they do not hold.
//
// Demo mode (no Supabase env vars) has no auth and exactly one local user,
// who owns everything on screen — so the answer is yes without a round trip.
// That is also what makes `npm run dev:verify` able to exercise these flows
// at all (CLAUDE.md rule 1).
import { useEffect, useState } from 'react';
import { authEnabled } from './supabase';
import { canWithMatrix, resolveMatrix, type MatrixCapability } from './org-permissions';
import type { OrgRole } from './permissions';

export function useOrgCapability(cap: MatrixCapability): boolean {
  const [allowed, setAllowed] = useState(!authEnabled);

  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    Promise.all([
      fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/org/permissions', { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([me, perms]) => {
      if (cancelled) return;
      const matrix = perms?.ok
        ? perms.resolved as Record<MatrixCapability, OrgRole[]>
        : resolveMatrix(null);
      setAllowed(canWithMatrix(matrix, me?.orgRole as OrgRole | undefined, cap));
    }).catch(() => { if (!cancelled) setAllowed(false); });
    return () => { cancelled = true; };
  }, [cap]);

  return allowed;
}
