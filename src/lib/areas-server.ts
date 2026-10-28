// Prompt 923 (A) — the server half of "where does this person go": reads the signals once, applies the rule in areas.ts, and falls back to the destinations an account WITHOUT an area has (a pending claim, a pending
// ecosystem invitation, the public page). Used by /go (the router after every sign-in), by the two landing pages and by /api/me, so they can never disagree.
import 'server-only';
import type { User } from '@supabase/supabase-js';
import { areasOf, landingArea, AREA_PATH, type Area, type Intent } from './areas';
import { decideRole } from './role-decision';
import { hasPendingIncubatorMemberInvite } from './incubator-pending-server';
import { landingDestination } from './landing-redirect';
import { resolveRoleSignals, type serverClient } from './supabase-server';

export interface AreaResolution { areas: Area[]; area: Area | null; path: string | null }

/** `path: null` = this account has no home (the public landing renders instead of a redirect). */
export async function resolveAreaDestination(
  user: Pick<User, 'id' | 'email' | 'email_confirmed_at' | 'user_metadata'>, sb: Awaited<ReturnType<typeof serverClient>>, opts: { intent?: Intent | null; last?: Area | null } = {},
): Promise<AreaResolution> {
  const signals = await resolveRoleSignals(user.id, user.email, sb, user.email_confirmed_at);
  const areas = areasOf(signals);
  const area = landingArea(areas, opts);
  if (area) return { areas, area, path: AREA_PATH[area] };
  // No area: a pending claim, a pending ecosystem invitation, or nothing — the same answers as before (landing-redirect.ts).
  const role = decideRole(signals);
  const path = landingDestination(role, {
    pendingIncubatorMemberInvite: role === 'none' ? await hasPendingIncubatorMemberInvite(user as User) : false,
    signupIntent: (user.user_metadata?.signup_intent as string | undefined) ?? null,
  });
  return { areas, area: null, path };
}
