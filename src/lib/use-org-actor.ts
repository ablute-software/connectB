'use client';
// Who is looking at this page, for the controls that are only an offer: a member who may change the organisation's settings, a Developer Viewer (reads
// everything the founder sees, changes nothing), or anyone else.
//
// A COURTESY, never the gate — the write routes check the same rule themselves (`manage_org_settings` in /api/org/update, the viewer write gate for a viewer
// session). It fails CLOSED: a failed fetch must not hand anyone a button that would be refused. Demo mode (no Supabase env vars) has no auth and one local
// user who owns everything on screen, the same rule as the Settings page and useOrgCapability.
import { useEffect, useState } from 'react';
import { authEnabled } from './supabase';
import { can, type OrgRole } from './permissions';

export interface OrgActor {
  /** A Developer Viewer session: reading a company's workspace, read-only. */
  viewer: boolean;
  /** An owner or an admin of the organisation on screen (or the demo user). */
  canManageOrgSettings: boolean;
}

export function useOrgActor(): OrgActor {
  const [actor, setActor] = useState<OrgActor>({ viewer: false, canManageOrgSettings: !authEnabled });
  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => {
      if (cancelled) return;
      setActor({ viewer: !!me?.viewer, canManageOrgSettings: can(me?.orgRole as OrgRole | null | undefined, 'manage_org_settings') });
    }).catch(() => { if (!cancelled) setActor({ viewer: false, canManageOrgSettings: false }); });
    return () => { cancelled = true; };
  }, []);
  return actor;
}
