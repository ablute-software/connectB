// Prompt 556 — server-side reads for orgs.closed_at (migration 0305).
//
// "Closed" is what an org becomes when its last member is deleted: the rows
// all stay, the account is over. Two consequences live here — the capability
// probe (so an environment without 0305 degrades to "nothing is closed"
// rather than erroring on an unknown column) and the one shared 410 that
// every startup-detail portal route returns for a closed org.
//
// 410 Gone, not 404: the investor is not being told a startup they may not
// see doesn't exist (that's what the dossier route's flat 404 is for, and it
// stays). They are being told a startup they legitimately had a relationship
// with has ended. The distinction is deliberate — the client renders the
// note from it.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { makeCapabilityProbe } from './capability-probe';

export const STARTUP_UNAVAILABLE_REASON = 'startup_unavailable';
export const STARTUP_UNAVAILABLE_MESSAGE = 'This startup is no longer available';

export const orgClosedAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('orgs').select('closed_at').limit(1);
  return !error;
});

export async function closedOrgIds(admin: SupabaseClient, orgIds: string[]): Promise<Set<string>> {
  if (orgIds.length === 0 || !(await orgClosedAvailable())) return new Set();
  const { data } = await admin.from('orgs').select('id').in('id', orgIds).not('closed_at', 'is', null);
  return new Set((data ?? []).map((o) => o.id as string));
}

export async function isOrgClosed(admin: SupabaseClient, orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  return (await closedOrgIds(admin, [orgId])).has(orgId);
}

// Returns the 410 to hand straight back, or null to carry on. Written as a
// guard rather than a boolean so all ~30 call sites are one identical line
// and the body can never drift between routes.
export async function closedOrgGuard(admin: SupabaseClient, orgId: string | null | undefined) {
  if (!(await isOrgClosed(admin, orgId))) return null;
  return NextResponse.json(
    { ok: false, error: STARTUP_UNAVAILABLE_MESSAGE, reason: STARTUP_UNAVAILABLE_REASON },
    { status: 410 },
  );
}
